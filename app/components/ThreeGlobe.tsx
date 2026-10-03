"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { feature } from "topojson-client";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type { Topology } from "topojson-specification";
import worldAtlas from "world-atlas/countries-110m.json";

const coinLocations: Record<string, [number, number]> = {
  BTC: [38, -122],
  ETH: [52, 7],
  SOL: [1, 104],
  XRP: [35, 139],
  BNB: [25, 55],
};

const coinColors: Record<string, number> = {
  BTC: 0xff9b00,
  ETH: 0x7f8cff,
  SOL: 0x00f2d0,
  XRP: 0x22d8ff,
  BNB: 0xffc21d,
};

function spherePoint(latitude: number, longitude: number, radius: number) {
  const phi = ((90 - latitude) * Math.PI) / 180;
  const theta = ((longitude + 180) * Math.PI) / 180;
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

function inEllipse(
  latitude: number,
  longitude: number,
  centerLat: number,
  centerLon: number,
  latRadius: number,
  lonRadius: number,
) {
  const lonDelta = Math.min(Math.abs(longitude - centerLon), 360 - Math.abs(longitude - centerLon));
  return ((latitude - centerLat) / latRadius) ** 2 + (lonDelta / lonRadius) ** 2 < 1;
}

function isLand(latitude: number, longitude: number) {
  return (
    inEllipse(latitude, longitude, 47, -105, 28, 54) ||
    inEllipse(latitude, longitude, 18, -94, 17, 25) ||
    inEllipse(latitude, longitude, -17, -61, 38, 25) ||
    inEllipse(latitude, longitude, 7, 22, 39, 28) ||
    inEllipse(latitude, longitude, 49, 65, 26, 92) ||
    inEllipse(latitude, longitude, 24, 103, 27, 52) ||
    inEllipse(latitude, longitude, -25, 134, 15, 23) ||
    inEllipse(latitude, longitude, 65, -41, 10, 17)
  );
}

type ThreeGlobeProps = {
  selectedCoin: string;
  range: string;
  paused: boolean;
};

export default function ThreeGlobe({ selectedCoin, range, paused }: ThreeGlobeProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const options = useRef({ selectedCoin, range, paused });
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    options.current = { selectedCoin, range, paused };
  }, [selectedCoin, range, paused]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(37, 1, 0.1, 100);
    camera.position.set(0, 0.18, 5.25);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
      });
    } catch {
      const fallback = window.setTimeout(() => setUnavailable(true), 0);
      return () => window.clearTimeout(fallback);
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute(
      "aria-label",
      "Interactive 3D crypto network globe. Drag to rotate and scroll to zoom.",
    );
    renderer.domElement.setAttribute("role", "img");
    mount.appendChild(renderer.domElement);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(900, 500), 1.08, 0.48, 0.36);
    composer.addPass(bloom);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.055;
    controls.enablePan = false;
    controls.minDistance = 4.25;
    controls.maxDistance = 6.1;
    controls.autoRotate = false;
    const rotationSpeeds: Record<string, number> = {
      "1H": 0.12,
      "1D": 0.1,
      "1W": 0.085,
      "1M": 0.075,
      "3M": 0.065,
      "1Y": 0.055,
      ALL: 0.05,
    };

    scene.add(new THREE.AmbientLight(0x3d58ff, 1.05));
    const cyanLight = new THREE.PointLight(0x00dfff, 16, 9);
    cyanLight.position.set(2.4, 1.7, 3.2);
    scene.add(cyanLight);
    const pinkLight = new THREE.PointLight(0xff2be6, 2.5, 8);
    pinkLight.position.set(-2.6, -0.8, 2.2);
    scene.add(pinkLight);
    const emberLight = new THREE.PointLight(0xff3d20, 13, 7);
    emberLight.position.set(-2.7, 0.45, 2.4);
    scene.add(emberLight);

    const globeGroup = new THREE.Group();
    globeGroup.position.x = -0.55;
    globeGroup.rotation.x = -0.07;
    globeGroup.rotation.y = -1.82;
    scene.add(globeGroup);

    const landCanvas = document.createElement("canvas");
    landCanvas.width = 2048;
    landCanvas.height = 1024;
    const landContext = landCanvas.getContext("2d");
    if (landContext) {
      const landGradient = landContext.createLinearGradient(0, 0, landCanvas.width, 0);
      landGradient.addColorStop(0, "#ff4a1f");
      landGradient.addColorStop(0.38, "#ff4121");
      landGradient.addColorStop(0.49, "#e51aae");
      landGradient.addColorStop(0.57, "#315bff");
      landGradient.addColorStop(0.78, "#008cff");
      landGradient.addColorStop(1, "#00eaff");
      const mapPoint = ([longitude, latitude]: [number, number]) =>
        [
          ((longitude + 180) / 360) * landCanvas.width,
          ((90 - latitude) / 180) * landCanvas.height,
        ] as const;
      const atlasTopology = worldAtlas as unknown as Topology;
      const countries = feature(
        atlasTopology,
        atlasTopology.objects.countries,
      ) as unknown as FeatureCollection;
      countries.features.forEach((country, countryIndex) => {
        const geometry = country.geometry as Polygon | MultiPolygon | null;
        if (!geometry) return;
        const polygons =
          geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
        const path = new Path2D();
        polygons.forEach((polygon) =>
          polygon.forEach((ring) => {
            let previousX: number | undefined;
            ring.forEach((point, index) => {
              const [x, y] = mapPoint(point as [number, number]);
              if (
                !index ||
                (previousX !== undefined && Math.abs(x - previousX) > landCanvas.width * 0.5)
              )
                path.moveTo(x, y);
              else path.lineTo(x, y);
              previousX = x;
            });
            path.closePath();
          }),
        );
        landContext.save();
        landContext.globalAlpha = 0.74;
        landContext.fillStyle = landGradient;
        landContext.shadowBlur = 7;
        landContext.shadowColor = countryIndex % 3 === 0 ? "#ff2d9d" : "#087cff";
        landContext.fill(path, "evenodd");
        landContext.shadowBlur = 0;
        landContext.lineWidth = 1.35;
        landContext.strokeStyle =
          countryIndex % 3 === 0 ? "rgba(255,78,174,.9)" : "rgba(30,176,255,.86)";
        landContext.stroke(path);
        landContext.restore();
      });
    }
    const landTexture = new THREE.CanvasTexture(landCanvas);
    landTexture.colorSpace = THREE.SRGBColorSpace;
    landTexture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

    const earth = new THREE.Mesh(
      new THREE.SphereGeometry(1.52, 72, 72),
      new THREE.MeshPhysicalMaterial({
        color: 0x01061d,
        emissive: 0x02134b,
        emissiveIntensity: 0.72,
        roughness: 0.38,
        metalness: 0.12,
        transparent: true,
        opacity: 0.96,
        clearcoat: 0.65,
        clearcoatRoughness: 0.2,
      }),
    );
    globeGroup.add(earth);

    const grid = new THREE.Mesh(
      new THREE.SphereGeometry(1.535, 36, 24),
      new THREE.MeshBasicMaterial({
        color: 0x176dff,
        wireframe: true,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
      }),
    );
    globeGroup.add(grid);
    const landSurface = new THREE.Mesh(
      new THREE.SphereGeometry(1.55, 96, 64),
      new THREE.MeshBasicMaterial({
        map: landTexture,
        transparent: true,
        opacity: 0.16,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    globeGroup.add(landSurface);
    const magentaGrid = new THREE.Mesh(
      new THREE.SphereGeometry(1.542, 24, 18),
      new THREE.MeshBasicMaterial({
        color: 0xd725ff,
        wireframe: true,
        transparent: true,
        opacity: 0.075,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    magentaGrid.rotation.y = 0.12;
    globeGroup.add(magentaGrid);

    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(1.66, 64, 64),
      new THREE.ShaderMaterial({
        transparent: true,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        vertexShader:
          "varying vec3 vNormal; varying vec3 vPosition; void main(){vNormal=normalize(normalMatrix*normal);vPosition=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
        fragmentShader:
          "varying vec3 vNormal; varying vec3 vPosition; void main(){float edge=max(0.0,0.72-dot(vNormal,vec3(0.0,0.0,1.0)));float i=pow(edge,2.35);vec3 cyan=vec3(0.0,0.31,0.78);vec3 ember=vec3(0.72,0.06,0.01);float blend=smoothstep(-0.85,0.35,vPosition.x);gl_FragColor=vec4(mix(ember,cyan,blend),1.0)*i;}",
      }),
    );
    globeGroup.add(atmosphere);

    const landPixels = landContext?.getImageData(0, 0, landCanvas.width, landCanvas.height).data;
    const textureHasLand = (latitude: number, longitude: number) => {
      if (!landPixels) return isLand(latitude, longitude);
      const x = Math.max(
        0,
        Math.min(
          landCanvas.width - 1,
          Math.round(((longitude + 180) / 360) * (landCanvas.width - 1)),
        ),
      );
      const y = Math.max(
        0,
        Math.min(
          landCanvas.height - 1,
          Math.round(((90 - latitude) / 180) * (landCanvas.height - 1)),
        ),
      );
      return landPixels[(y * landCanvas.width + x) * 4 + 3] > 24;
    };
    const landPositions: number[] = [];
    const landColors: number[] = [];
    const activeColor = new THREE.Color(coinColors[options.current.selectedCoin] ?? 0x00dfff);
    for (let latitude = -78; latitude <= 84; latitude += 1.42) {
      for (let longitude = -180; longitude < 180; longitude += 1.42) {
        if (!textureHasLand(latitude, longitude)) continue;
        const noise = Math.sin(latitude * 12.9 + longitude * 4.7) * 0.5 + 0.5;
        if (noise < 0.15) continue;
        const point = spherePoint(latitude, longitude, 1.555 + noise * 0.005);
        landPositions.push(point.x, point.y, point.z);
        const west = new THREE.Color(noise > 0.52 ? 0xff5b20 : 0xff233d);
        const center = new THREE.Color(noise > 0.58 ? 0x4b4cff : 0x176cff);
        const east = new THREE.Color(noise > 0.62 ? 0x00e8ff : 0x1764ff);
        const hemisphere = longitude < -18 ? west : longitude < 58 ? center : east;
        const mix = hemisphere.lerp(
          activeColor,
          options.current.selectedCoin === "BTC" ? 0.06 : 0.12,
        );
        landColors.push(mix.r, mix.g, mix.b);
      }
    }
    const landGeometry = new THREE.BufferGeometry();
    landGeometry.setAttribute("position", new THREE.Float32BufferAttribute(landPositions, 3));
    landGeometry.setAttribute("color", new THREE.Float32BufferAttribute(landColors, 3));
    const land = new THREE.Points(
      landGeometry,
      new THREE.PointsMaterial({
        size: 0.035,
        vertexColors: true,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    globeGroup.add(land);

    const networkPoints = Array.from({ length: 108 }, (_, index) => ({
      latitude: Math.sin(index * 2.31) * 68,
      longitude: ((index * 137.508) % 360) - 180,
    }));
    const nodePositions: number[] = [];
    const nodeColors: number[] = [];
    networkPoints.forEach((node, index) => {
      const point = spherePoint(node.latitude, node.longitude, 1.585);
      nodePositions.push(point.x, point.y, point.z);
      const color = new THREE.Color(
        index % 5 === 0 ? 0xff2be6 : index % 3 === 0 ? 0x2e72ff : 0x00e7ff,
      );
      nodeColors.push(color.r, color.g, color.b);
    });
    const nodeGeometry = new THREE.BufferGeometry();
    nodeGeometry.setAttribute("position", new THREE.Float32BufferAttribute(nodePositions, 3));
    nodeGeometry.setAttribute("color", new THREE.Float32BufferAttribute(nodeColors, 3));
    const nodes = new THREE.Points(
      nodeGeometry,
      new THREE.PointsMaterial({
        size: 0.046,
        vertexColors: true,
        transparent: true,
        opacity: 0.98,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    globeGroup.add(nodes);

    const arcGroup = new THREE.Group();
    for (let index = 0; index < 54; index++) {
      const source = networkPoints[index];
      const target = networkPoints[(index * 7 + 13) % networkPoints.length];
      const start = spherePoint(source.latitude, source.longitude, 1.59);
      const end = spherePoint(target.latitude, target.longitude, 1.59);
      const midpoint = start
        .clone()
        .add(end)
        .multiplyScalar(0.5)
        .normalize()
        .multiplyScalar(2.0 + (index % 4) * 0.08);
      const curve = new THREE.QuadraticBezierCurve3(start, midpoint, end);
      const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(42));
      const material = new THREE.LineBasicMaterial({
        color: index % 3 === 0 ? 0xff32e6 : index % 2 ? 0x087dff : 0x00dfff,
        transparent: true,
        opacity: 0.36,
        blending: THREE.AdditiveBlending,
      });
      arcGroup.add(new THREE.Line(geometry, material));
    }
    globeGroup.add(arcGroup);

    Object.entries(coinLocations).forEach(([symbol, [latitude, longitude]]) => {
      const color = coinColors[symbol];
      const position = spherePoint(latitude, longitude, 1.64);
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.032, 20, 20),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4 }),
      );
      marker.position.copy(position);
      marker.userData.symbol = symbol;
      marker.userData.phase = Object.keys(coinLocations).indexOf(symbol);
      globeGroup.add(marker);
    });

    const starPositions: number[] = [];
    for (let index = 0; index < 420; index++) {
      const radius = 7 + (index % 9) * 0.22;
      const theta = index * 2.399;
      const y = ((index * 83) % 200) / 100 - 1;
      const radial = Math.sqrt(1 - Math.min(1, y * y));
      starPositions.push(
        Math.cos(theta) * radial * radius,
        y * radius,
        Math.sin(theta) * radial * radius,
      );
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute("position", new THREE.Float32BufferAttribute(starPositions, 3));
    scene.add(
      new THREE.Points(
        starGeometry,
        new THREE.PointsMaterial({
          color: 0x3f6eff,
          size: 0.018,
          transparent: true,
          opacity: 0.45,
          depthWrite: false,
        }),
      ),
    );

    const resize = () => {
      const { width, height } = mount.getBoundingClientRect();
      if (!width || !height) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      composer.setSize(width, height);
      bloom.setSize(width, height);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();

    let frame = 0;
    const animationStartedAt = performance.now();
    let previousFrameAt = animationStartedAt;
    const animate = () => {
      const frameAt = performance.now();
      const delta = Math.min((frameAt - previousFrameAt) / 1000, 0.05);
      const elapsed = (frameAt - animationStartedAt) / 1000;
      previousFrameAt = frameAt;
      if (renderer.getContext().isContextLost()) {
        setUnavailable(true);
        return;
      }
      const { selectedCoin: activeCoin, range: activeRange, paused: isPaused } = options.current;
      const reduceMotion =
        isPaused || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!reduceMotion && document.visibilityState === "visible")
        globeGroup.rotation.y += delta * (rotationSpeeds[activeRange] ?? 0.1);
      controls.update();
      arcGroup.rotation.y = reduceMotion ? 0 : Math.sin(elapsed * 0.12) * 0.035;
      nodes.material.opacity = reduceMotion ? 0.85 : 0.72 + Math.sin(elapsed * 2.1) * 0.18;
      globeGroup.children.forEach((child) => {
        if (child.userData.symbol) {
          const selected = child.userData.symbol === activeCoin;
          const pulse =
            (selected ? 2.125 : 0.75) *
            (reduceMotion ? 1 : 1 + Math.sin(elapsed * 2.8 + child.userData.phase) * 0.18);
          child.scale.setScalar(pulse);
          (child as THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>).material.opacity =
            selected ? 0.92 : 0.4;
        }
      });
      composer.render();
      frame = window.requestAnimationFrame(animate);
    };
    animate();

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      composer.dispose();
      renderer.dispose();
      landTexture.dispose();
      scene.traverse((object) => {
        if (
          object instanceof THREE.Mesh ||
          object instanceof THREE.Points ||
          object instanceof THREE.Line
        ) {
          object.geometry?.dispose();
          const material = object.material as THREE.Material | THREE.Material[];
          if (Array.isArray(material)) material.forEach((item) => item.dispose());
          else material?.dispose();
        }
      });
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div ref={mountRef} className="three-globe">
      {unavailable && (
        <div className="globe-unavailable" role="status">
          <span>3D globe unavailable on this device</span>
          <small>Live markets and analysis remain available</small>
        </div>
      )}
    </div>
  );
}
