import React, { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Scene from './components/Scene';
import './index.css';

gsap.registerPlugin(ScrollTrigger);

const GLASS_HALF_HEIGHT = 3.8;
const GLASS_OUTER_RADIUS = 2.8;
const GLASS_NECK_RADIUS = 0.1;
const WALL_MARGIN = 0.18;
const TAU = Math.PI * 2;

const orbitSections = [
  {
    id: 'hero',
    className: 'hero',
    sentence: 'Business on autopilot reclaims your time',
  },
  {
    id: 'services',
    className: 'shell',
    sentence: 'The Shell makes your digital presence impossible to ignore',
  },
  {
    id: 'brain',
    className: 'brain',
    sentence: 'The Brain connects your site CRM billing and notifications',
  },
  {
    id: 'ecosystem',
    className: 'ecosystem',
    sentence: 'Full Ecosystem digitizes everything from first click to invoice',
  },
  {
    id: 'contact',
    className: 'cta',
    sentence: 'How much is missing automation costing you today',
  },
];

function clamp01(value) {
  return gsap.utils.clamp(0, 1, value);
}

function smoothstep(min, max, value) {
  const t = clamp01((value - min) / (max - min));
  return t * t * (3 - 2 * t);
}

function mix(start, end, alpha) {
  return start + (end - start) * alpha;
}

function normalizeReadableAngle(angle) {
  let normalized = angle;

  while (normalized > 90) {
    normalized -= 180;
  }

  while (normalized < -90) {
    normalized += 180;
  }

  return normalized;
}

function orbitWrapAt(t) {
  const wrapIn = smoothstep(0.0, 0.08, t);
  const wrapOut = 1 - smoothstep(0.92, 1.0, t);
  return wrapIn * wrapOut;
}

function getCharWeight(char) {
  if (char === ' ') {
    return 0.42;
  }

  if (/[.,!?;:]/u.test(char)) {
    return 0.7;
  }

  return 1;
}

function renderSentenceLabel(section) {
  return section.sentence;
}

function SentenceRibbon({ sentence }) {
  const chars = Array.from(sentence.toUpperCase());

  return (
    <>
      <span className="sr-only">{sentence}</span>
      <div className="orbit-sentence" aria-hidden="true">
        {chars.map((char, index) => (
          <span
            key={`${sentence}-${index}`}
            className={`orbit-char${char === ' ' ? ' orbit-char--space' : ''}`}
            data-char-weight={getCharWeight(char).toFixed(2)}
          >
            {char === ' ' ? '\u00A0' : char}
          </span>
        ))}
      </div>
    </>
  );
}

function buildSentencePair(frontElement, backElement) {
  if (!frontElement || !backElement) {
    return null;
  }

  const frontChars = Array.from(frontElement.querySelectorAll('.orbit-char'));
  const backChars = Array.from(backElement.querySelectorAll('.orbit-char'));
  const sentence = frontChars.map((node) => (node.textContent === '\u00A0' ? ' ' : node.textContent)).join('');
  const weights = frontChars.map((node) => Number(node.dataset.charWeight ?? 1));
  const totalUnits = weights.reduce((sum, weight) => sum + weight, 0);
  const cumulativeUnits = [0];

  let cursor = 0;

  const chars = frontChars.map((frontNode, index) => {
    const weight = weights[index];
    const unitStart = cursor;
    cursor += weight;
    cumulativeUnits.push(cursor);

    return {
      frontNode,
      backNode: backChars[index],
      index,
      isSpace: frontNode.classList.contains('orbit-char--space'),
      unitStart,
      weight,
      advance: 0,
      advanceStart: 0,
    };
  });

  const firstWordBreak = sentence.indexOf(' ');
  const firstWordCount = firstWordBreak === -1 ? chars.length : Math.max(firstWordBreak, 1);

  return {
    frontElement,
    backElement,
    chars,
    cumulativeUnits,
    cumulativeAdvance: [0],
    firstWordCount,
    averageAdvance: 0,
    totalAdvance: 0,
    totalUnits,
  };
}

function setCopyStyle(element, x, y, rotateZ, opacity) {
  if (!element) {
    return;
  }

  element.style.setProperty('--orbit-x', `${x.toFixed(2)}px`);
  element.style.setProperty('--orbit-y', `${y.toFixed(2)}px`);
  element.style.setProperty('--orbit-rotate-z', `${rotateZ.toFixed(2)}deg`);
  element.style.setProperty('--orbit-opacity', opacity.toFixed(3));
}

function setCharStyle(node, x, y, z, rotateY, rotateZ, scale, opacity) {
  if (!node) {
    return;
  }

  node.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, ${z.toFixed(2)}px) translate(-50%, -50%) rotateY(${rotateY.toFixed(2)}deg) rotateZ(${rotateZ.toFixed(2)}deg) scale(${scale.toFixed(3)})`;
  node.style.opacity = opacity.toFixed(3);
}

function glassInnerRadiusPxAtY(y, layout) {
  const worldY = y / layout.worldToPx;
  const normalizedHeight = clamp01(Math.abs(worldY) / GLASS_HALF_HEIGHT);
  const innerRadius = Math.max(mix(GLASS_NECK_RADIUS, GLASS_OUTER_RADIUS, normalizedHeight) - WALL_MARGIN, 0.02);
  return innerRadius * layout.worldToPx;
}

function sampleOrbitPoint(layout, t) {
  const clampedT = clamp01(t);
  const y = mix(-layout.topY, layout.bottomY, clampedT);
  const shellRadius = glassInnerRadiusPxAtY(y, layout);
  const radiusNorm = clamp01(
    (shellRadius - layout.innerNeckRadius) / Math.max(layout.innerOuterRadius - layout.innerNeckRadius, 1),
  );
  const borderInset = mix(layout.minInset, layout.maxInset, Math.pow(radiusNorm, 0.9));
  const theta = layout.startAngle + layout.totalAngle * clampedT;
  const orbitRadius = Math.max(shellRadius - borderInset, layout.minTravelRadius);

  return {
    x: Math.sin(theta) * orbitRadius,
    y,
    z: Math.cos(theta) * orbitRadius * layout.depthFactor,
    theta,
    wrap: orbitWrapAt(clampedT),
    radiusNorm,
    orbitRadius,
    shellRadius,
  };
}

function measurePairAdvances(pair) {
  if (!pair) {
    return;
  }

  const cumulativeAdvance = [0];
  let cursor = 0;

  pair.chars.forEach((charState) => {
    const measuredWidth = charState.frontNode.offsetWidth || 0;
    const fallbackWidth = charState.isSpace ? 16 : 24;
    const baseWidth = measuredWidth > 0 ? measuredWidth : fallbackWidth;
    const advance = Math.max(baseWidth * (charState.isSpace ? 0.96 : 1.02) + (charState.isSpace ? 2 : 4), charState.isSpace ? 15 : 18);

    charState.advanceStart = cursor;
    charState.advance = advance;
    cursor += advance;
    cumulativeAdvance.push(cursor);
  });

  pair.cumulativeAdvance = cumulativeAdvance;
  pair.totalAdvance = cursor;
  pair.averageAdvance = cursor / Math.max(pair.chars.length, 1);
}

function advanceAtCount(pair, countFloat) {
  const clampedCount = gsap.utils.clamp(0, pair.chars.length, countFloat);
  const whole = Math.floor(clampedCount);
  const fraction = clampedCount - whole;
  const currentAdvance = pair.cumulativeAdvance[whole] ?? pair.totalAdvance;
  const nextAdvance = pair.cumulativeAdvance[Math.min(whole + 1, pair.chars.length)] ?? pair.totalAdvance;

  return mix(currentAdvance, nextAdvance, fraction);
}

function createPathLayout(viewportWidth, viewportHeight, isMobile) {
  const topY = viewportHeight * (isMobile ? 0.34 : 0.31);
  const bottomY = viewportHeight * (isMobile ? 0.38 : 0.35);
  const worldToPx = ((topY + bottomY) * 0.5) / GLASS_HALF_HEIGHT;
  const innerOuterRadius = Math.max((GLASS_OUTER_RADIUS - WALL_MARGIN) * worldToPx, isMobile ? 88 : 120);
  const innerNeckRadius = Math.max(0.02 * worldToPx, isMobile ? 2.5 : 3);
  const depthFactor = isMobile ? 0.72 : 0.78;
  const minInset = isMobile ? 1.4 : 2.2;
  const maxInset = isMobile ? 8.4 : 12;
  const minScale = isMobile ? 0.08 : 0.1;
  const maxScale = isMobile ? 0.66 : 0.82;
  const minTravelRadius = isMobile ? 1.4 : 2;
  const startAngle = Math.PI * 0.5;
  const totalAngle = Math.PI * 3;
  const orbitSamples = isMobile ? 140 : 180;
  const entrySamples = 14;
  const exitSamples = 14;
  const entryStartPoint = {
    x: viewportWidth * (isMobile ? 0.62 : 0.7),
    y: -topY,
    z: 0,
    theta: startAngle,
    wrap: 0,
    radiusNorm: 1,
    orbitRadius: innerOuterRadius - minInset,
    shellRadius: innerOuterRadius,
  };
  const exitEndPoint = {
    x: -viewportWidth * (isMobile ? 0.68 : 0.76),
    y: bottomY,
    z: 0,
    theta: startAngle + totalAngle,
    wrap: 0,
    radiusNorm: 1,
    orbitRadius: innerOuterRadius - minInset,
    shellRadius: innerOuterRadius,
  };
  const orbitPoints = Array.from({ length: orbitSamples }, (_, index) => {
    const t = index / (orbitSamples - 1);
    return sampleOrbitPoint(
      {
        topY,
        bottomY,
        worldToPx,
        innerOuterRadius,
        innerNeckRadius,
        depthFactor,
        minInset,
        maxInset,
        minTravelRadius,
        startAngle,
        totalAngle,
      },
      t,
    );
  });
  const orbitStartPoint = orbitPoints[0];
  const orbitEndPoint = orbitPoints[orbitPoints.length - 1];
  const entryPoints = Array.from({ length: entrySamples }, (_, index) => {
    const t = index / (entrySamples - 1);

    return {
      x: mix(entryStartPoint.x, orbitStartPoint.x, t),
      y: mix(entryStartPoint.y, orbitStartPoint.y, t),
      z: 0,
      theta: startAngle,
      wrap: 0,
      radiusNorm: mix(1, orbitStartPoint.radiusNorm, t),
      orbitRadius: mix(innerOuterRadius - minInset, orbitStartPoint.orbitRadius, t),
      shellRadius: mix(innerOuterRadius, orbitStartPoint.shellRadius, t),
    };
  });
  const exitPoints = Array.from({ length: exitSamples }, (_, index) => {
    const t = index / (exitSamples - 1);

    return {
      x: mix(orbitEndPoint.x, exitEndPoint.x, t),
      y: mix(orbitEndPoint.y, exitEndPoint.y, t),
      z: 0,
      theta: startAngle + totalAngle,
      wrap: 0,
      radiusNorm: mix(orbitEndPoint.radiusNorm, 1, t),
      orbitRadius: mix(orbitEndPoint.orbitRadius, innerOuterRadius - minInset, t),
      shellRadius: mix(orbitEndPoint.shellRadius, innerOuterRadius, t),
    };
  });
  const pathPoints = [...entryPoints, ...orbitPoints.slice(1), ...exitPoints.slice(1)];
  const pathDistances = [0];

  for (let index = 1; index < pathPoints.length; index += 1) {
    const previous = pathPoints[index - 1];
    const current = pathPoints[index];
    const segmentLength = Math.hypot(current.x - previous.x, current.y - previous.y, current.z - previous.z);
    pathDistances.push(pathDistances[index - 1] + segmentLength);
  }

  const entryLength = pathDistances[entrySamples - 1];
  const orbitStartDistance = entryLength;
  const orbitEndDistance = pathDistances[entrySamples + orbitPoints.length - 2];
  const totalPathLength = pathDistances[pathDistances.length - 1];
  const exitLength = totalPathLength - orbitEndDistance;

  return {
    topY,
    bottomY,
    worldToPx,
    innerOuterRadius,
    innerNeckRadius,
    depthFactor,
    minInset,
    maxInset,
    minScale,
    maxScale,
    minTravelRadius,
    startAngle,
    totalAngle,
    pathPoints,
    pathDistances,
    entryLength,
    exitLength,
    orbitStartDistance,
    orbitEndDistance,
    totalPathLength,
  };
}

function interpolatePathPoint(from, to, alpha) {
  return {
    x: mix(from.x, to.x, alpha),
    y: mix(from.y, to.y, alpha),
    z: mix(from.z, to.z, alpha),
    theta: mix(from.theta, to.theta, alpha),
    wrap: mix(from.wrap, to.wrap, alpha),
    radiusNorm: mix(from.radiusNorm, to.radiusNorm, alpha),
    orbitRadius: mix(from.orbitRadius, to.orbitRadius, alpha),
    shellRadius: mix(from.shellRadius, to.shellRadius, alpha),
  };
}

function samplePathSegment(layout, distance) {
  const { pathPoints, pathDistances, totalPathLength } = layout;

  if (distance <= 0) {
    return {
      start: pathPoints[0],
      end: pathPoints[1],
      alpha: distance / Math.max(pathDistances[1] - pathDistances[0], 1),
    };
  }

  if (distance >= totalPathLength) {
    const lastIndex = pathPoints.length - 1;
    return {
      start: pathPoints[lastIndex - 1],
      end: pathPoints[lastIndex],
      alpha:
        1 +
        (distance - totalPathLength) /
          Math.max(pathDistances[lastIndex] - pathDistances[lastIndex - 1], 1),
    };
  }

  let index = 1;

  while (index < pathDistances.length && pathDistances[index] < distance) {
    index += 1;
  }

  const startDistance = pathDistances[index - 1];
  const endDistance = pathDistances[index];

  return {
    start: pathPoints[index - 1],
    end: pathPoints[index],
    alpha: (distance - startDistance) / Math.max(endDistance - startDistance, 1),
  };
}

function samplePathPoint(layout, distance) {
  const { start, end, alpha } = samplePathSegment(layout, distance);
  return interpolatePathPoint(start, end, alpha);
}

function samplePathTangent(layout, distance) {
  const { start, end } = samplePathSegment(layout, distance);
  return {
    x: end.x - start.x,
    y: end.y - start.y,
    z: end.z - start.z,
  };
}

function getLayoutForPair(pair, viewportWidth, viewportHeight, isMobile) {
  const cacheKey = `${viewportWidth}x${viewportHeight}:${isMobile ? 'm' : 'd'}`;

  if (pair.layoutCache?.key === cacheKey) {
    return pair.layoutCache.value;
  }

  measurePairAdvances(pair);
  const layout = createPathLayout(viewportWidth, viewportHeight, isMobile);
  pair.layoutCache = { key: cacheKey, value: layout };

  return layout;
}

function updateSentencePair(pair, progress) {
  if (!pair) {
    return;
  }

  const isMobile = window.innerWidth < 768;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const layout = getLayoutForPair(pair, viewportWidth, viewportHeight, isMobile);
  const sectionOpacity = smoothstep(0, 0.04, progress) * (1 - smoothstep(0.96, 1, progress));
  const revealProgress = smoothstep(0, 0.36, progress);
  const hideProgress = smoothstep(0.78, 1, progress);
  let visibleCountFloat = mix(pair.firstWordCount, pair.chars.length, revealProgress);
  visibleCountFloat = mix(visibleCountFloat, pair.firstWordCount, hideProgress);
  const visibleAdvance = Math.max(advanceAtCount(pair, visibleCountFloat), pair.averageAdvance || 1);
  const firstWordAdvance = Math.max(advanceAtCount(pair, pair.firstWordCount), pair.averageAdvance || 1);
  const startLead = firstWordAdvance * 0.18;
  const endLead = layout.totalPathLength + layout.exitLength * 0.38 + visibleAdvance * 0.14;
  const leadDistance = mix(startLead, endLead, smoothstep(0.02, 0.98, progress));

  setCopyStyle(pair.frontElement, 0, 0, 0, sectionOpacity);
  setCopyStyle(pair.backElement, 0, 0, 0, sectionOpacity);

  pair.chars.forEach((charState) => {
    const presence = smoothstep(charState.index - 0.35, charState.index + 0.65, visibleCountFloat);
    const advanceMid = charState.advanceStart + charState.advance * 0.5;
    const distance = leadDistance - advanceMid;
    const point = samplePathPoint(layout, distance);
    const tangent = samplePathTangent(layout, distance);
    const zRatio = point.orbitRadius > 0 ? point.z / (point.orbitRadius * layout.depthFactor) : 0;
    const orbitBackness = smoothstep(0.02, 0.9, -zRatio);
    const orbitFrontness = smoothstep(-0.12, 0.22, zRatio);
    const wrapStrength = Math.pow(point.wrap, 1.15);
    const backness = orbitBackness * wrapStrength;
    const frontness = mix(1, orbitFrontness, wrapStrength);
    const rawSlope = Math.atan2(tangent.y, Math.max(0.001, tangent.x)) * (180 / Math.PI);
    const slope = point.wrap > 0.02 ? normalizeReadableAngle(rawSlope) : 0;
    const wrapRotate = -Math.sin(point.theta) * (isMobile ? 68 : 82) * wrapStrength;
    const radiusScale = mix(layout.minScale, layout.maxScale, Math.pow(point.radiusNorm, 0.92));
    const perspectiveScale = mix(1, isMobile ? 0.9 : 0.84, backness);
    const scale = mix(1, radiusScale * perspectiveScale, point.wrap);
    const frontOpacity = sectionOpacity * frontness * presence;
    const backOpacity = sectionOpacity * backness * 0.82 * presence;

    setCharStyle(
      charState.frontNode,
      point.x,
      point.y,
      point.z,
      wrapRotate,
      slope,
      scale,
      frontOpacity,
    );

    setCharStyle(
      charState.backNode,
      point.x,
      point.y,
      point.z,
      wrapRotate + 180,
      slope,
      scale,
      backOpacity,
    );
  });
}

function App() {
  const containerRef = useRef(null);
  const scrollProgress = useRef(0);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.utils.toArray('.orbit-marker').forEach((marker) => {
        const orbitId = marker.dataset.orbitId;
        const frontElement = containerRef.current?.querySelector(
          `.orbit-stage--front .orbit-copy[data-orbit-id="${orbitId}"]`,
        );
        const backElement = containerRef.current?.querySelector(
          `.orbit-stage--back .orbit-copy[data-orbit-id="${orbitId}"]`,
        );
        const pair = buildSentencePair(frontElement, backElement);

        updateSentencePair(pair, 0);

        ScrollTrigger.create({
          trigger: marker,
          start: 'top bottom',
          end: 'bottom top',
          scrub: true,
          invalidateOnRefresh: true,
          onUpdate: (self) => {
            updateSentencePair(pair, self.progress);
          },
          onRefresh: (self) => {
            updateSentencePair(pair, self.progress);
          },
        });
      });
    }, containerRef);

    const handleScroll = () => {
      const scrollY = window.scrollY;
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      scrollProgress.current = maxScroll > 0 ? scrollY / maxScroll : 0;
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();

    return () => {
      ctx.revert();
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  return (
    <div ref={containerRef} className="app-wrapper">
      <div className="orbit-stage orbit-stage--back" aria-hidden="true">
        {orbitSections.map((section) => (
          <div key={`back-${section.id}`} className="orbit-copy orbit-copy--center" data-orbit-id={section.id}>
            <SentenceRibbon sentence={section.sentence} />
          </div>
        ))}
      </div>

      <div className="canvas-container">
        <Scene scrollProgress={scrollProgress} />
      </div>

      <div className="orbit-stage orbit-stage--front" aria-hidden="true">
        {orbitSections.map((section) => (
          <div key={`front-${section.id}`} className="orbit-copy orbit-copy--center" data-orbit-id={section.id}>
            <SentenceRibbon sentence={section.sentence} />
          </div>
        ))}
      </div>

      <header className="site-header container">
        <div className="logo">YOTA</div>
        <nav>
          <a href="#services">Services</a>
          <a href="#ecosystem">Ecosystem</a>
          <a href="#contact" className="btn-primary" style={{ padding: '0.5rem 1.5rem', fontSize: '0.8rem' }}>
            Hire Us
          </a>
        </nav>
      </header>

      <main>
        {orbitSections.map((section) => (
          <section
            key={section.id}
            id={section.id === 'hero' ? undefined : section.id}
            className={`orbit-marker orbit-section container ${section.className}`}
            data-orbit-id={section.id}
            aria-label={renderSentenceLabel(section)}
          >
            <div className="orbit-marker__spacer" />
          </section>
        ))}
      </main>
    </div>
  );
}

export default App;
