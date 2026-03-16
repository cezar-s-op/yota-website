import React from 'react';
import { Canvas } from '@react-three/fiber';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import AbstractHourglass from './AbstractHourglass';

export default function Scene({ scrollProgress }) {
  return (
    <Canvas
      camera={{ position: [0, 0, 12], fov: 45 }}
      gl={{ alpha: true, antialias: true }}
      onCreated={({ gl }) => {
        gl.setClearColor('#030303', 0);
      }}
      style={{ background: 'transparent' }}
    >
      <ambientLight intensity={0.5} />
      <AbstractHourglass scrollProgress={scrollProgress} />
      <EffectComposer disableNormalPass>
        <Bloom luminanceThreshold={0.1} mipmapBlur intensity={1.5} />
      </EffectComposer>
    </Canvas>
  );
}
