import React, { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { MeshTransmissionMaterial } from '@react-three/drei';

const PARTICLE_COUNT = 12000;
const GLASS_HALF_HEIGHT = 3.8;
const GLASS_OUTER_RADIUS = 2.8;
const GLASS_NECK_RADIUS = 0.1;
const WALL_MARGIN = 0.18;
const TOP_MIN_Y = 0.16;
const TOP_MAX_Y = 3.62;
const BOTTOM_MIN_Y = -3.62;
const BOTTOM_MAX_Y = -0.16;
const FLOW_WINDOW = 0.14;
const STREAM_RADIUS = 0.095;
const POINT_SIZE = 42;
const ROTATION_SPEED = 0.1;
const PROGRESS_DAMPING = 7;
const EDGE_FILL_RESERVE = 0.08;
const GLASS_PROFILE_SAMPLES = 33;
const GLASS_RADIAL_SEGMENTS = 64;
const TIME_LOOP = 4096;
const TAU = Math.PI * 2;

const TOP_COLOR = new THREE.Color('#ff7a1a');
const BOTTOM_COLOR = new THREE.Color('#35d7ff');
const FLOW_HIGHLIGHT = new THREE.Color('#fff4d6');

const vertexShader = `
  uniform float uPointSize;

  attribute vec3 color;

  varying vec3 vColor;

  void main() {
    vColor = color;

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = uPointSize / max(1.0, -mvPosition.z);
  }
`;

const fragmentShader = `
  varying vec3 vColor;

  void main() {
    vec2 centered = gl_PointCoord - vec2(0.5);
    float dist = dot(centered, centered);

    if (dist > 0.25) {
      discard;
    }

    float alpha = smoothstep(0.25, 0.0, dist);
    gl_FragColor = vec4(vColor, alpha);
  }
`;

function clamp01(value) {
  return THREE.MathUtils.clamp(value, 0, 1);
}

function inverseLerp(min, max, value) {
  if (Math.abs(max - min) < 1e-6) {
    return 0;
  }

  return clamp01((value - min) / (max - min));
}

function smoothstep(min, max, value) {
  const t = inverseLerp(min, max, value);
  return t * t * (3 - 2 * t);
}

function lerp(start, end, alpha) {
  return start + (end - start) * alpha;
}

function mapScrollProgress(value) {
  return lerp(EDGE_FILL_RESERVE, 1 - EDGE_FILL_RESERVE, clamp01(value));
}

function createRandom(seed) {
  let state = seed >>> 0;

  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function glassShellRadiusAtY(y) {
  const normalizedHeight = clamp01(Math.abs(y) / GLASS_HALF_HEIGHT);
  return lerp(GLASS_NECK_RADIUS, GLASS_OUTER_RADIUS, normalizedHeight);
}

function glassInnerRadiusAtY(y) {
  const radius = glassShellRadiusAtY(y) - WALL_MARGIN;
  return Math.max(radius, 0.02);
}

function createGlassProfile(sampleCount) {
  return Array.from({ length: sampleCount }, (_, index) => {
    const t = index / (sampleCount - 1);
    const y = lerp(-GLASS_HALF_HEIGHT, GLASS_HALF_HEIGHT, t);
    return new THREE.Vector2(glassShellRadiusAtY(y), y);
  });
}

function createParticleSystem(count) {
  const random = createRandom(0x59f2c3a1);

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const orders = new Float32Array(count);
  const angleSeeds = new Float32Array(count);
  const radiusSeeds = new Float32Array(count);
  const streamSeeds = new Float32Array(count);
  const wobbleSeeds = new Float32Array(count);

  for (let index = 0; index < count; index += 1) {
    orders[index] = (index + random()) / count;
    angleSeeds[index] = random() * TAU;
    radiusSeeds[index] = random();
    streamSeeds[index] = random();
    wobbleSeeds[index] = random();
  }

  return { positions, colors, orders, angleSeeds, radiusSeeds, streamSeeds, wobbleSeeds };
}

function updateParticleSystem(system, progress, time) {
  const {
    positions,
    colors,
    orders,
    angleSeeds,
    radiusSeeds,
    streamSeeds,
    wobbleSeeds,
  } = system;

  const topFillFloor = lerp(TOP_MIN_Y, TOP_MAX_Y, progress);
  const bottomFillCeiling = lerp(BOTTOM_MIN_Y, BOTTOM_MAX_Y, progress);

  for (let index = 0; index < orders.length; index += 1) {
    const order = orders[index];
    const angleSeed = angleSeeds[index];
    const radiusSeed = radiusSeeds[index];
    const streamSeed = streamSeeds[index];
    const wobbleSeed = wobbleSeeds[index];
    const i3 = index * 3;

    const topLocal = inverseLerp(progress, 1, order);
    const bottomLocal = progress <= 0 ? 0 : clamp01(order / progress);

    const topY = lerp(topFillFloor, TOP_MAX_Y, Math.pow(topLocal, 1.1));
    const bottomY = lerp(BOTTOM_MIN_Y, bottomFillCeiling, Math.pow(bottomLocal, 1.1));

    const topRadius = glassInnerRadiusAtY(topY) * Math.sqrt(radiusSeed);
    const bottomRadius = glassInnerRadiusAtY(bottomY) * Math.sqrt(radiusSeed);

    const topX = Math.cos(angleSeed) * topRadius;
    const topZ = Math.sin(angleSeed) * topRadius;
    const bottomX = Math.cos(angleSeed) * bottomRadius;
    const bottomZ = Math.sin(angleSeed) * bottomRadius;

    const fallStart = Math.max(order - FLOW_WINDOW * 0.5, 0);
    const fallEnd = Math.min(order + FLOW_WINDOW * 0.5, 1);
    const fallProgress = smoothstep(fallStart, fallEnd, progress);

    let x = topX;
    let y = topY;
    let z = topZ;

    if (fallProgress > 0 && fallProgress < 1) {
      const streamAngle = angleSeed + time * (2 + wobbleSeed * 1.6) + fallProgress * TAU * 1.5;
      const streamRadius = STREAM_RADIUS * (0.35 + radiusSeed * 0.65);
      const neckX = Math.cos(streamAngle) * streamRadius;
      const neckY = Math.sin(time * 1.5 + streamSeed * TAU) * 0.05;
      const neckZ = Math.sin(streamAngle) * streamRadius;

      if (fallProgress < 0.5) {
        const streamAlpha = smoothstep(0, 0.5, fallProgress);
        x = lerp(topX, neckX, streamAlpha);
        y = lerp(topY, neckY, streamAlpha);
        z = lerp(topZ, neckZ, streamAlpha);
      } else {
        const streamAlpha = smoothstep(0.5, 1, fallProgress);
        x = lerp(neckX, bottomX, streamAlpha);
        y = lerp(neckY, bottomY, streamAlpha);
        z = lerp(neckZ, bottomZ, streamAlpha);
      }

      const streamGlow = 1 - Math.abs(fallProgress * 2 - 1);
      const streamOffset = 0.03 * streamGlow;
      x += Math.cos(streamAngle * 1.9 + streamSeed * TAU) * streamOffset;
      z += Math.sin(streamAngle * 1.7 + wobbleSeed * TAU) * streamOffset;
    } else if (fallProgress >= 1) {
      x = bottomX;
      y = bottomY;
      z = bottomZ;
    }

    positions[i3] = x;
    positions[i3 + 1] = y;
    positions[i3 + 2] = z;

    const glowMix = (1 - Math.abs(fallProgress * 2 - 1)) * 0.45;
    const baseR = lerp(TOP_COLOR.r, BOTTOM_COLOR.r, fallProgress);
    const baseG = lerp(TOP_COLOR.g, BOTTOM_COLOR.g, fallProgress);
    const baseB = lerp(TOP_COLOR.b, BOTTOM_COLOR.b, fallProgress);

    colors[i3] = lerp(baseR, FLOW_HIGHLIGHT.r, glowMix);
    colors[i3 + 1] = lerp(baseG, FLOW_HIGHLIGHT.g, glowMix);
    colors[i3 + 2] = lerp(baseB, FLOW_HIGHLIGHT.b, glowMix);
  }
}

export default function AbstractHourglass({ scrollProgress }) {
  const pointsRef = useRef(null);
  const positionAttributeRef = useRef(null);
  const colorAttributeRef = useRef(null);
  const progressRef = useRef(mapScrollProgress(scrollProgress?.current ?? 0));

  const particleSystem = useMemo(() => createParticleSystem(PARTICLE_COUNT), []);
  const glassProfile = useMemo(() => createGlassProfile(GLASS_PROFILE_SAMPLES), []);
  const uniforms = useMemo(() => ({ uPointSize: { value: POINT_SIZE } }), []);

  useLayoutEffect(() => {
    if (!positionAttributeRef.current || !colorAttributeRef.current) {
      return;
    }

    updateParticleSystem(particleSystem, mapScrollProgress(scrollProgress?.current ?? 0), 0);

    positionAttributeRef.current.setUsage(THREE.DynamicDrawUsage);
    colorAttributeRef.current.setUsage(THREE.DynamicDrawUsage);
    positionAttributeRef.current.needsUpdate = true;
    colorAttributeRef.current.needsUpdate = true;
  }, [particleSystem, scrollProgress]);

  useFrame((state, delta) => {
    if (!pointsRef.current || !positionAttributeRef.current || !colorAttributeRef.current) {
      return;
    }

    const targetProgress = mapScrollProgress(scrollProgress?.current ?? 0);
    progressRef.current = THREE.MathUtils.damp(progressRef.current, targetProgress, PROGRESS_DAMPING, delta);
    const time = state.clock.elapsedTime % TIME_LOOP;

    updateParticleSystem(particleSystem, progressRef.current, time);

    positionAttributeRef.current.needsUpdate = true;
    colorAttributeRef.current.needsUpdate = true;
    pointsRef.current.rotation.y = (pointsRef.current.rotation.y + delta * ROTATION_SPEED) % TAU;
  });

  return (
    <group>
      <mesh renderOrder={1}>
        <latheGeometry args={[glassProfile, GLASS_RADIAL_SEGMENTS]} />
        <MeshTransmissionMaterial
          backside
          samples={4}
          thickness={0.5}
          chromaticAberration={0.05}
          anisotropy={0.1}
          distortion={0.1}
          distortionScale={0.5}
          temporalDistortion={0.1}
          clearcoat={1}
          attenuationDistance={0.5}
          attenuationColor="#ffffff"
          color="#1a1a1a"
          transparent
          depthWrite={false}
          opacity={0.3}
        />
      </mesh>

      <points ref={pointsRef} frustumCulled={false} renderOrder={2}>
        <bufferGeometry>
          <bufferAttribute
            ref={positionAttributeRef}
            attach="attributes-position"
            count={particleSystem.positions.length / 3}
            array={particleSystem.positions}
            itemSize={3}
          />
          <bufferAttribute
            ref={colorAttributeRef}
            attach="attributes-color"
            count={particleSystem.colors.length / 3}
            array={particleSystem.colors}
            itemSize={3}
          />
        </bufferGeometry>
        <shaderMaterial
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          uniforms={uniforms}
          transparent
          depthTest={false}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </points>
    </group>
  );
}
