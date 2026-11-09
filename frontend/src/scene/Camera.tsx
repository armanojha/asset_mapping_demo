/**
 * Polished Isometric Camera & Navigation System for the Village Asset Mapping System.
 *
 * Capabilities:
 * 1. Orthographic camera configured to true mathematical isometric axonometry:
 *    Position = [D, D, D] -> Pitch = atan(1 / sqrt(2)) ~ 35.264°, Azimuth = 45°.
 * 2. Village boundary clamping: prevents panning off into infinite space.
 * 3. Smooth damping for mouse drag, mouse wheel, and touch gestures.
 * 4. Imperative handles for view reset, top-down cadastral mode, and feature focusing.
 * 5. High performance: Zero React re-renders during camera navigation.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { OrthographicCamera, OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';

export interface CameraHandle {
  resetCamera: () => void;
  setTopDownView: () => void;
  setIsometricView: () => void;
  setRevenueOverview: () => void;
  setAbadiFocus: () => void;
  setRiverfrontFocus: () => void;
  focusOnCoordinates: (x: number, z: number, targetZoom?: number) => void;
  getControls: () => OrbitControlsImpl | null;
}

export interface CameraProps {
  isometricDistance?: number;   // Distance parameter D for position [D, D, D] (Default: 350)
  zoom?: number;                // Initial orthographic zoom level (Default: 1.4)
  target?: [number, number, number]; // Initial target (Default: [0, 0, 0])
  enableDamping?: boolean;      // Default: true
  dampingFactor?: number;       // Default: 0.05
  minZoom?: number;             // Default: 0.35
  maxZoom?: number;             // Default: 16.0
  boundaryExtentMeters?: number; // Distance in meters from origin before panning is clamped (Default: 2000)
  enableRotate?: boolean;       // Default: true
}

export const Camera = forwardRef<CameraHandle, CameraProps>(
  (
    {
      isometricDistance = 350,
      zoom = 1.4,
      target = [0, 0, 0],
      enableDamping = true,
      dampingFactor = 0.05,
      minZoom = 0.20,
      maxZoom = 16.0,
      boundaryExtentMeters = 2500,
      enableRotate = true,
    },
    ref
  ) => {
    const controlsRef = useRef<OrbitControlsImpl>(null);
    const cameraRef = useRef<THREE.OrthographicCamera>(null);

    // Default true isometric position: [D, D, D]
    const defaultPosition: [number, number, number] = [
      isometricDistance,
      isometricDistance,
      isometricDistance,
    ];

    useImperativeHandle(ref, () => ({
      resetCamera: () => {
        if (controlsRef.current && cameraRef.current) {
          controlsRef.current.target.set(target[0], target[1], target[2]);
          controlsRef.current.object.position.set(
            defaultPosition[0],
            defaultPosition[1],
            defaultPosition[2]
          );
          cameraRef.current.zoom = zoom;
          cameraRef.current.updateProjectionMatrix();
          controlsRef.current.update();
        }
      },
      setIsometricView: () => {
        if (controlsRef.current && cameraRef.current) {
          controlsRef.current.target.set(0, 0, 0);
          controlsRef.current.object.position.set(
            defaultPosition[0],
            defaultPosition[1],
            defaultPosition[2]
          );
          cameraRef.current.zoom = zoom;
          cameraRef.current.updateProjectionMatrix();
          controlsRef.current.update();
        }
      },
      setRevenueOverview: () => {
        if (controlsRef.current && cameraRef.current) {
          controlsRef.current.target.set(0, 0, -200);
          controlsRef.current.object.position.set(
            defaultPosition[0] * 2.5,
            defaultPosition[1] * 2.5,
            defaultPosition[2] * 2.5
          );
          cameraRef.current.zoom = 0.35;
          cameraRef.current.updateProjectionMatrix();
          controlsRef.current.update();
        }
      },
      setAbadiFocus: () => {
        if (controlsRef.current && cameraRef.current) {
          controlsRef.current.target.set(0, 0, 0);
          controlsRef.current.object.position.set(
            defaultPosition[0] * 0.7,
            defaultPosition[1] * 0.7,
            defaultPosition[2] * 0.7
          );
          cameraRef.current.zoom = 2.4;
          cameraRef.current.updateProjectionMatrix();
          controlsRef.current.update();
        }
      },
      setRiverfrontFocus: () => {
        if (controlsRef.current && cameraRef.current) {
          controlsRef.current.target.set(0, 0, -520);
          controlsRef.current.object.position.set(
            defaultPosition[0] * 0.8,
            defaultPosition[1] * 0.8,
            defaultPosition[2] * 0.8 - 520
          );
          cameraRef.current.zoom = 1.6;
          cameraRef.current.updateProjectionMatrix();
          controlsRef.current.update();
        }
      },
      setTopDownView: () => {
        if (controlsRef.current && cameraRef.current) {
          controlsRef.current.target.set(0, 0, 0);
          // Position directly above with slight Z tilt to maintain up-vector
          controlsRef.current.object.position.set(0, 350, 0.001);
          cameraRef.current.zoom = zoom * 1.1;
          cameraRef.current.updateProjectionMatrix();
          controlsRef.current.update();
        }
      },
      focusOnCoordinates: (x: number, z: number, targetZoom?: number) => {
        if (controlsRef.current && cameraRef.current) {
          const deltaX = x - controlsRef.current.target.x;
          const deltaZ = z - controlsRef.current.target.z;

          controlsRef.current.target.set(x, 0, z);
          controlsRef.current.object.position.x += deltaX;
          controlsRef.current.object.position.z += deltaZ;

          if (targetZoom) {
            cameraRef.current.zoom = targetZoom;
            cameraRef.current.updateProjectionMatrix();
          }
          controlsRef.current.update();
        }
      },
      getControls: () => controlsRef.current,
    }));

    // TASK 4: Camera Boundary Enforcement
    // Clamps pan target within boundaryExtentMeters so users never lose the village in space
    useEffect(() => {
      const controls = controlsRef.current;
      if (!controls) return;

      const handleControlsChange = () => {
        const t = controls.target;
        const limit = boundaryExtentMeters;

        let clampedX = Math.max(-limit, Math.min(limit, t.x));
        let clampedZ = Math.max(-limit, Math.min(limit, t.z));

        if (clampedX !== t.x || clampedZ !== t.z) {
          const deltaX = clampedX - t.x;
          const deltaZ = clampedZ - t.z;

          t.x = clampedX;
          t.z = clampedZ;

          // Adjust camera eye by the same clamp delta
          controls.object.position.x += deltaX;
          controls.object.position.z += deltaZ;
        }
      };

      controls.addEventListener('change', handleControlsChange);
      return () => {
        controls.removeEventListener('change', handleControlsChange);
      };
    }, [boundaryExtentMeters]);

    return (
      <>
        {/* Orthographic Camera with True Isometric Perspective */}
        <OrthographicCamera
          ref={cameraRef}
          makeDefault
          position={defaultPosition}
          zoom={zoom}
          near={-1500}
          far={3500}
        />

        {/* Bounded, Damped Orbit & Pan Controls */}
        <OrbitControls
          ref={controlsRef}
          target={target}
          enableRotate={enableRotate}
          enableDamping={enableDamping}
          dampingFactor={dampingFactor}
          screenSpacePanning={true} // Intuitive planar screen-space pan
          minPolarAngle={Math.PI / 6.0}   // 30° - prevents steep top disorientation
          maxPolarAngle={Math.PI / 2.15}  // ~83° - prevents peering under diorama base
          minZoom={minZoom}
          maxZoom={maxZoom}
        />
      </>
    );
  }
);

Camera.displayName = 'IsometricCamera';
