/**
 * Isometric Camera & Controls for the Village Asset Mapping System.
 * Implements an Orthographic camera positioned at equal [D, D, D] Cartesian coordinates,
 * yielding an exact axonometric projection:
 * Pitch = atan(1 / sqrt(2)) ~ 35.264 degrees, Azimuth = 45 degrees.
 */

import { forwardRef, useImperativeHandle, useRef } from 'react';
import { OrthographicCamera, OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';

export interface CameraHandle {
  resetCamera: () => void;
  getControls: () => OrbitControlsImpl | null;
}

export interface CameraProps {
  isometricDistance?: number; // Distance parameter D for position [D, D, D]
  zoom?: number;              // Initial orthographic zoom level
  target?: [number, number, number];
  enableDamping?: boolean;
  dampingFactor?: number;
  minZoom?: number;
  maxZoom?: number;
}

export const Camera = forwardRef<CameraHandle, CameraProps>(
  (
    {
      isometricDistance = 250,
      zoom = 2.4,
      target = [0, 0, 0],
      enableDamping = true,
      dampingFactor = 0.05,
      minZoom = 0.5,
      maxZoom = 15.0,
    },
    ref
  ) => {
    const controlsRef = useRef<OrbitControlsImpl>(null);
    const cameraRef = useRef<any>(null);

    // Initial isometric position: [D, D, D]
    const defaultPosition: [number, number, number] = [
      isometricDistance,
      isometricDistance,
      isometricDistance,
    ];

    useImperativeHandle(ref, () => ({
      resetCamera: () => {
        if (controlsRef.current) {
          controlsRef.current.target.set(target[0], target[1], target[2]);
          controlsRef.current.object.position.set(
            defaultPosition[0],
            defaultPosition[1],
            defaultPosition[2]
          );
          if (cameraRef.current) {
            cameraRef.current.zoom = zoom;
            cameraRef.current.updateProjectionMatrix();
          }
          controlsRef.current.update();
        }
      },
      getControls: () => controlsRef.current,
    }));

    return (
      <>
        {/* Orthographic Camera with True Isometric Perspective */}
        <OrthographicCamera
          ref={cameraRef}
          makeDefault
          position={defaultPosition}
          zoom={zoom}
          near={-1200}
          far={3000}
        />

        {/* Smooth Orbit & Pan Controls */}
        <OrbitControls
          ref={controlsRef}
          target={target}
          enableDamping={enableDamping}
          dampingFactor={dampingFactor}
          maxPolarAngle={Math.PI / 2.05} // Prevent camera going below ground plane
          minZoom={minZoom}
          maxZoom={maxZoom}
        />
      </>
    );
  }
);

Camera.displayName = 'IsometricCamera';
