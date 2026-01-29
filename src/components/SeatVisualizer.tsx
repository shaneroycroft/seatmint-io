import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';

interface Tier {
  id: number;
  name: string;
  price: number;
  depth: number;
  width: number;
  pitch: number;
  color: number;
  layout: 'fanned' | 'rectangular';
}

interface Obstruction {
  x: number;
  z: number;
  radius: number;
  height: number;
}

interface Marker {
  mesh: THREE.Mesh;
  element: HTMLDivElement;
}

interface SelectedSeat {
  mesh: THREE.InstancedMesh;
  index: number;
  originalColor: THREE.Color;
  tier: Tier;
  label: { row: string; seat: string };
}

interface SeatVisualizerProps {
  onSeatSelect?: (seat: { tier: string; row: string; seat: string; price: number }) => void;
  readOnly?: boolean;
}

const DEFAULT_TIERS: Tier[] = [
  { id: 1, name: "Orchestra", price: 120, depth: 30, width: 80, pitch: 0.04, color: 0x2563eb, layout: 'rectangular' },
  { id: 2, name: "Mezzanine", price: 65, depth: 25, width: 120, pitch: 0.12, color: 0x3b82f6, layout: 'fanned' }
];

export const SeatVisualizer: React.FC<SeatVisualizerProps> = ({ onSeatSelect, readOnly = false }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const labelContainerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Three.js refs
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const raycasterRef = useRef(new THREE.Raycaster());
  const meshesRef = useRef<THREE.InstancedMesh[]>([]);
  const markersRef = useRef<Marker[]>([]);
  const animationRef = useRef<number>(0);

  // State
  const [appMode, setAppMode] = useState<'design' | 'preview'>('design');
  const [viewMode, setViewMode] = useState<'orbital' | 'pov'>('orbital');
  const [tiers, setTiers] = useState<Tier[]>(DEFAULT_TIERS);
  const [obstructions, setObstructions] = useState<Obstruction[]>([]);
  const [stageWidth, setStageWidth] = useState(30);
  const [selectedSeat, setSelectedSeat] = useState<SelectedSeat | null>(null);
  const [hoveredSeat, setHoveredSeat] = useState<{ tier: Tier; row: string; seat: string; price: number } | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Camera state refs (mutable for animation loop)
  const orbitRef = useRef({ lon: 200, lat: 30, radius: 200 });
  const povRef = useRef({ pos: new THREE.Vector3(0, 10, 100), lookAt: new THREE.Vector3(0, 4, 0) });
  const mouseRef = useRef(new THREE.Vector2());
  const isDraggingRef = useRef(false);
  const prevMouseRef = useRef({ x: 0, y: 0 });
  const intersectedRef = useRef<{ mesh: THREE.InstancedMesh | null; index: number | null; color: THREE.Color }>({
    mesh: null, index: null, color: new THREE.Color()
  });

  const stageHeight = 4;

  // Get seat label from position
  const getSeatLabel = useCallback((_tier: Tier, r: number, c: number, rows: number, _cols: number) => {
    const rowLabel = rows <= 3
      ? (r === 0 ? "Front" : r === rows - 1 ? "Rear" : "Middle")
      : `Row ${String.fromCharCode(65 + r)}`;
    const seatLabel = `Seat ${c + 1}`;
    return { row: rowLabel, seat: seatLabel };
  }, []);

  // Build venue
  const refreshVenue = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Cleanup existing meshes
    meshesRef.current.forEach(m => scene.remove(m));
    meshesRef.current = [];
    scene.children.filter(o => (o as any).isMarker || (o as any).isStage || (o as any).isObstruction)
      .forEach(o => scene.remove(o));
    markersRef.current.forEach(m => m.element.remove());
    markersRef.current = [];

    // Stage
    const stageGeo = new THREE.BoxGeometry(stageWidth, stageHeight, 22);
    const stageMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8, metalness: 0.1 });
    const stage = new THREE.Mesh(stageGeo, stageMat);
    stage.position.set(0, stageHeight / 2, 0);
    stage.receiveShadow = true;
    stage.castShadow = true;
    (stage as any).isStage = true;
    scene.add(stage);

    // Obstructions
    obstructions.forEach(obs => {
      const geo = new THREE.CylinderGeometry(obs.radius, obs.radius, obs.height, 32);
      const mat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.7 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(obs.x, obs.height / 2, obs.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      (mesh as any).isObstruction = true;
      scene.add(mesh);
    });

    // Build tiers
    let zStart = 22;
    let baseY = 0.5;

    tiers.forEach(tier => {
      const rows = Math.max(1, Math.round(tier.depth / 2.5));
      const cols = Math.max(1, Math.round(tier.width / 4));
      const total = rows * cols;

      const seatGeo = new THREE.BoxGeometry(0.85, 0.55, 0.85);
      const seatMat = new THREE.MeshStandardMaterial({ color: tier.color, roughness: 0.7, metalness: 0.05 });
      const mesh = new THREE.InstancedMesh(seatGeo, seatMat, total);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData = { tier, rows, cols };

      const dummy = new THREE.Object3D();
      const arcRad = THREE.MathUtils.degToRad(tier.width);
      let maxBound = 0;
      let maxY = 0;

      for (let r = 0; r < rows; r++) {
        const rowY = baseY + (r * tier.pitch * 6);
        maxY = Math.max(maxY, rowY);

        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          const colPct = cols > 1 ? c / (cols - 1) : 0.5;

          if (tier.layout === 'fanned') {
            const angle = -arcRad / 2 + colPct * arcRad + Math.PI / 2;
            const rad = zStart + (r * 2.5);
            dummy.position.set(Math.cos(angle) * rad, rowY, Math.sin(angle) * rad);
            dummy.lookAt(0, rowY, 0);
            maxBound = Math.max(maxBound, rad);
          } else {
            const w = tier.width * 0.8;
            const x = -w / 2 + colPct * w;
            const z = zStart + (r * 2.5);
            dummy.position.set(x, rowY, z);
            dummy.rotation.set(0, 0, 0);
            maxBound = Math.max(maxBound, Math.sqrt(x * x + z * z));
          }

          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
          mesh.setColorAt!(i, new THREE.Color(tier.color));
        }
      }

      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      scene.add(mesh);
      meshesRef.current.push(mesh);

      // Add section marker
      if (labelContainerRef.current) {
        const markerGeo = new THREE.SphereGeometry(1.8, 16, 16);
        const markerMat = new THREE.MeshBasicMaterial({ color: 0x2563eb, transparent: true, opacity: 0.7 });
        const markerMesh = new THREE.Mesh(markerGeo, markerMat);
        markerMesh.position.set(0, maxY + 6, zStart + (rows * 2.5) / 2);
        (markerMesh as any).isMarker = true;
        (markerMesh as any).userData = { label: tier.name };
        scene.add(markerMesh);

        const div = document.createElement('div');
        div.className = 'absolute bg-slate-900 text-white px-3 py-1.5 rounded-lg text-xs font-bold pointer-events-none -translate-x-1/2 opacity-0 transition-opacity whitespace-nowrap shadow-lg';
        div.innerText = tier.name;
        labelContainerRef.current.appendChild(div);
        markersRef.current.push({ mesh: markerMesh, element: div });
      }

      zStart = maxBound + 14;
      baseY = maxY + 3;
    });
  }, [tiers, obstructions, stageWidth, stageHeight]);

  // Initialize Three.js
  useEffect(() => {
    if (!containerRef.current) return;

    // Wait for container to have dimensions
    const { clientWidth, clientHeight } = containerRef.current;
    if (clientWidth === 0 || clientHeight === 0) {
      console.warn('SeatVisualizer: Container has 0 dimensions, waiting for layout...');
      const retryTimeout = setTimeout(() => {
        // Force re-render to retry initialization
        setTiers(prev => [...prev]);
      }, 100);
      return () => clearTimeout(retryTimeout);
    }

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf1f5f9);
    scene.fog = new THREE.Fog(0xf1f5f9, 250, 1200);
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(50, containerRef.current.clientWidth / containerRef.current.clientHeight, 0.5, 3000);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.75);
    scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffffff, 0.7);
    sun.position.set(60, 250, 120);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 500;
    sun.shadow.camera.left = -150;
    sun.shadow.camera.right = 150;
    sun.shadow.camera.top = 150;
    sun.shadow.camera.bottom = -150;
    scene.add(sun);

    // Ground
    const groundGeo = new THREE.PlaneGeometry(2000, 2000);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.9 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.1;
    ground.receiveShadow = true;
    scene.add(ground);

    // Show onboarding if first visit
    if (!localStorage.getItem('seatmint-visualizer-visited')) {
      setTimeout(() => setShowOnboarding(true), 500);
    }

    // Cleanup
    return () => {
      cancelAnimationFrame(animationRef.current);
      renderer.dispose();
      if (containerRef.current && renderer.domElement) {
        containerRef.current.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Rebuild venue when config changes
  useEffect(() => {
    refreshVenue();
  }, [refreshVenue]);

  // Animation loop
  useEffect(() => {
    const animate = () => {
      animationRef.current = requestAnimationFrame(animate);

      const camera = cameraRef.current;
      const renderer = rendererRef.current;
      const scene = sceneRef.current;
      if (!camera || !renderer || !scene) return;

      // Camera animation
      if (viewMode === 'orbital') {
        const phi = THREE.MathUtils.degToRad(90 - orbitRef.current.lat);
        const theta = THREE.MathUtils.degToRad(orbitRef.current.lon);
        const target = new THREE.Vector3().setFromSphericalCoords(orbitRef.current.radius, phi, theta);
        camera.position.lerp(target, 0.08);
        camera.lookAt(0, stageHeight / 2, 0);
      } else {
        camera.position.lerp(povRef.current.pos, 0.08);
        camera.lookAt(povRef.current.lookAt);
      }

      // Update marker positions
      if (appMode === 'design') {
        markersRef.current.forEach(m => {
          m.mesh.visible = true;
          const v = m.mesh.position.clone().project(camera);
          if (v.z < 1) {
            m.element.style.display = 'block';
            m.element.style.left = `${((v.x * 0.5 + 0.5) * (containerRef.current?.clientWidth || 0))}px`;
            m.element.style.top = `${((-v.y * 0.5 + 0.5) * (containerRef.current?.clientHeight || 0))}px`;
          } else {
            m.element.style.display = 'none';
          }
        });
      } else {
        markersRef.current.forEach(m => {
          m.mesh.visible = false;
          m.element.style.display = 'none';
        });
      }

      renderer.render(scene, camera);
    };

    animate();
    return () => cancelAnimationFrame(animationRef.current);
  }, [viewMode, appMode, stageHeight]);

  // Event handlers
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onPointerMove = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      if (isDraggingRef.current) {
        const dx = e.clientX - prevMouseRef.current.x;
        const dy = e.clientY - prevMouseRef.current.y;

        if (viewMode === 'orbital') {
          orbitRef.current.lon -= dx * 0.25;
          orbitRef.current.lat = Math.max(5, Math.min(85, orbitRef.current.lat + dy * 0.25));
        }
        prevMouseRef.current = { x: e.clientX, y: e.clientY };
        return;
      }

      const camera = cameraRef.current;
      if (!camera) return;

      raycasterRef.current.setFromCamera(mouseRef.current, camera);

      if (appMode === 'preview') {
        const intersects = raycasterRef.current.intersectObjects(meshesRef.current);

        if (intersects.length > 0) {
          const hit = intersects[0];
          const mesh = hit.object as THREE.InstancedMesh;
          const id = hit.instanceId!;

          if (intersectedRef.current.mesh !== mesh || intersectedRef.current.index !== id) {
            // Restore previous
            if (intersectedRef.current.mesh && !(selectedSeat?.mesh === intersectedRef.current.mesh && selectedSeat?.index === intersectedRef.current.index)) {
              intersectedRef.current.mesh.setColorAt!(intersectedRef.current.index!, intersectedRef.current.color);
              if (intersectedRef.current.mesh.instanceColor) intersectedRef.current.mesh.instanceColor.needsUpdate = true;
            }

            // Store and highlight new
            intersectedRef.current.mesh = mesh;
            intersectedRef.current.index = id;
            mesh.getColorAt!(id, intersectedRef.current.color);

            if (!(selectedSeat?.mesh === mesh && selectedSeat?.index === id)) {
              mesh.setColorAt!(id, new THREE.Color(0xffffff));
              if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
            }

            // Update tooltip
            const { rows, cols, tier } = mesh.userData;
            const r = Math.floor(id / cols);
            const c = id % cols;
            const label = getSeatLabel(tier, r, c, rows, cols);
            setHoveredSeat({ tier, row: label.row, seat: label.seat, price: tier.price });
          }

          if (tooltipRef.current) {
            tooltipRef.current.style.left = `${e.clientX - rect.left}px`;
            tooltipRef.current.style.top = `${e.clientY - rect.top}px`;
          }
          container.style.cursor = 'pointer';
        } else {
          if (intersectedRef.current.mesh) {
            if (!(selectedSeat?.mesh === intersectedRef.current.mesh && selectedSeat?.index === intersectedRef.current.index)) {
              intersectedRef.current.mesh.setColorAt!(intersectedRef.current.index!, intersectedRef.current.color);
              if (intersectedRef.current.mesh.instanceColor) intersectedRef.current.mesh.instanceColor.needsUpdate = true;
            }
            intersectedRef.current.mesh = null;
          }
          setHoveredSeat(null);
          container.style.cursor = 'default';
        }
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      isDraggingRef.current = true;
      prevMouseRef.current = { x: e.clientX, y: e.clientY };
    };

    const onPointerUp = (e: PointerEvent) => {
      const wasDragging = isDraggingRef.current;
      const dragDistance = Math.hypot(e.clientX - prevMouseRef.current.x, e.clientY - prevMouseRef.current.y);
      isDraggingRef.current = false;

      if (wasDragging && dragDistance > 5) return;

      if (appMode === 'preview' && intersectedRef.current.mesh && intersectedRef.current.index !== null) {
        const mesh = intersectedRef.current.mesh;
        const id = intersectedRef.current.index;
        const { rows, cols, tier } = mesh.userData;
        const r = Math.floor(id / cols);
        const c = id % cols;
        const label = getSeatLabel(tier, r, c, rows, cols);

        // Clear previous selection
        if (selectedSeat) {
          selectedSeat.mesh.setColorAt!(selectedSeat.index, selectedSeat.originalColor);
          if (selectedSeat.mesh.instanceColor) selectedSeat.mesh.instanceColor.needsUpdate = true;
        }

        // Get seat position for POV
        const dummy = new THREE.Object3D();
        mesh.getMatrixAt(id, dummy.matrix);
        dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);
        const eyePos = dummy.position.clone().add(new THREE.Vector3(0, 1.4, 0));

        povRef.current.pos.copy(eyePos);
        povRef.current.lookAt.set(0, stageHeight / 2, 0);
        setViewMode('pov');

        // Highlight
        const originalColor = new THREE.Color();
        mesh.getColorAt!(id, originalColor);
        mesh.setColorAt!(id, new THREE.Color(0xfbbf24));
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

        setSelectedSeat({ mesh, index: id, originalColor, tier, label });
        onSeatSelect?.({ tier: tier.name, row: label.row, seat: label.seat, price: tier.price });
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (viewMode === 'orbital') {
        orbitRef.current.radius = Math.max(50, Math.min(400, orbitRef.current.radius + e.deltaY * 0.3));
      }
    };

    const onResize = () => {
      const camera = cameraRef.current;
      const renderer = rendererRef.current;
      if (!camera || !renderer || !container) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };

    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointerup', onPointerUp);
    container.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('resize', onResize);

    return () => {
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointerup', onPointerUp);
      container.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', onResize);
    };
  }, [appMode, viewMode, selectedSeat, getSeatLabel, onSeatSelect, stageHeight]);

  const closeBuyPanel = () => {
    if (selectedSeat) {
      selectedSeat.mesh.setColorAt!(selectedSeat.index, selectedSeat.originalColor);
      if (selectedSeat.mesh.instanceColor) selectedSeat.mesh.instanceColor.needsUpdate = true;
      setSelectedSeat(null);
    }
    setViewMode('orbital');
  };

  const handleAppModeChange = (mode: 'design' | 'preview') => {
    setAppMode(mode);
    if (mode === 'preview') {
      setSidebarCollapsed(true);
      closeBuyPanel();
    } else {
      setSidebarCollapsed(false);
    }
    setViewMode('orbital');
  };

  const addTier = () => {
    const colors = [0x2563eb, 0x3b82f6, 0x60a5fa, 0x1d4ed8, 0x1e40af];
    setTiers(prev => [...prev, {
      id: Date.now(),
      name: "New Section",
      price: 50,
      depth: 20,
      width: 90,
      pitch: 0.1,
      color: colors[prev.length % colors.length],
      layout: 'fanned'
    }]);
  };

  const updateTier = (index: number, updates: Partial<Tier>) => {
    setTiers(prev => prev.map((t, i) => i === index ? { ...t, ...updates } : t));
  };

  const removeTier = (index: number) => {
    setTiers(prev => prev.filter((_, i) => i !== index));
  };

  const addObstruction = () => {
    setObstructions(prev => [...prev, { x: 0, z: 80, radius: 4, height: 30 }]);
  };

  const applyPreset = (preset: string) => {
    const presets: Record<string, Tier[]> = {
      stadium: [
        { id: Date.now(), name: "Lower Bowl", price: 150, depth: 40, width: 100, pitch: 0.06, color: 0x2563eb, layout: 'fanned' },
        { id: Date.now() + 1, name: "Upper Bowl", price: 80, depth: 35, width: 140, pitch: 0.2, color: 0x3b82f6, layout: 'fanned' }
      ],
      club: [
        { id: Date.now(), name: "Floor", price: 50, depth: 40, width: 60, pitch: 0, color: 0x2563eb, layout: 'rectangular' },
        { id: Date.now() + 1, name: "VIP", price: 200, depth: 15, width: 60, pitch: 0.1, color: 0x1d4ed8, layout: 'rectangular' }
      ],
      amphitheater: [
        { id: Date.now(), name: "Orchestra", price: 120, depth: 30, width: 80, pitch: 0.04, color: 0x2563eb, layout: 'rectangular' },
        { id: Date.now() + 1, name: "Mezzanine", price: 65, depth: 25, width: 120, pitch: 0.12, color: 0x3b82f6, layout: 'fanned' }
      ]
    };
    setTiers(presets[preset] || presets.amphitheater);
    setObstructions([]);
  };

  const dismissOnboarding = () => {
    setShowOnboarding(false);
    localStorage.setItem('seatmint-visualizer-visited', 'true');
  };

  return (
    <div className="relative w-full h-full bg-slate-100 overflow-hidden">
      {/* Three.js Container */}
      <div ref={containerRef} className="absolute inset-0" />

      {/* Marker Labels Container */}
      <div ref={labelContainerRef} className="absolute inset-0 pointer-events-none" />

      {/* Tooltip */}
      {hoveredSeat && (
        <div
          ref={tooltipRef}
          className="absolute pointer-events-none bg-slate-900/95 text-white px-4 py-3 rounded-xl text-sm z-50 -translate-x-1/2 -translate-y-[140%] shadow-xl border border-white/10 min-w-[160px]"
        >
          <div className="text-[10px] uppercase text-blue-400 font-bold tracking-widest mb-1">
            {hoveredSeat.tier.name}
          </div>
          <div className="font-bold">{hoveredSeat.row} - {hoveredSeat.seat}</div>
          <div className="text-slate-400 font-semibold">{hoveredSeat.price} ADA</div>
          <div className="mt-2 pt-2 border-t border-slate-700 text-[10px] text-slate-500">Click to select</div>
        </div>
      )}

      {/* Status Badge */}
      <div className="absolute top-6 right-6 z-40 bg-white/95 backdrop-blur-md px-5 py-3.5 rounded-2xl border border-slate-200/80 shadow-lg pointer-events-none">
        <div className="flex items-center gap-2.5 mb-1">
          <span className={`w-2.5 h-2.5 rounded-full ${appMode === 'preview' ? 'bg-green-500' : 'bg-blue-600'}`} />
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
            {appMode === 'preview' ? 'PREVIEW MODE' : 'DESIGN MODE'}
          </span>
        </div>
        <h2 className="text-lg font-black tracking-tight text-slate-900">
          {selectedSeat ? `${selectedSeat.tier.name} - ${selectedSeat.label.row} - ${selectedSeat.label.seat}` :
           appMode === 'preview' ? 'Select a seat' : 'Venue Designer'}
        </h2>
      </div>

      {/* Mode Controls */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-40 flex gap-4">
        <div className="bg-slate-900/95 backdrop-blur-md p-1.5 rounded-2xl flex border border-white/10 shadow-xl">
          <button
            onClick={() => handleAppModeChange('design')}
            className={`px-6 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wide transition-all ${
              appMode === 'design' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'
            }`}
          >
            Design
          </button>
          <button
            onClick={() => handleAppModeChange('preview')}
            className={`px-6 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wide transition-all ${
              appMode === 'preview' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'
            }`}
          >
            Preview
          </button>
        </div>

        <div className="bg-slate-900/95 backdrop-blur-md p-1.5 rounded-2xl flex border border-white/10 shadow-xl">
          <button
            onClick={() => setViewMode('orbital')}
            className={`px-6 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wide transition-all ${
              viewMode === 'orbital' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'
            }`}
          >
            Orbit
          </button>
          <button
            onClick={() => setViewMode('pov')}
            className={`px-6 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wide transition-all ${
              viewMode === 'pov' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'
            }`}
          >
            Seat View
          </button>
        </div>
      </div>

      {/* Design Sidebar */}
      {!readOnly && (
        <div className={`absolute top-0 left-0 h-full w-[340px] bg-white border-r border-slate-200 shadow-xl z-50 flex flex-col transition-transform duration-300 ${sidebarCollapsed ? '-translate-x-full' : ''}`}>
          {/* Toggle Button */}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="absolute -right-12 top-6 w-12 h-12 bg-white border border-slate-200 border-l-0 rounded-r-xl flex items-center justify-center text-slate-500 hover:text-blue-600 hover:bg-slate-50 transition shadow-md"
          >
            <svg className={`w-5 h-5 transition-transform ${sidebarCollapsed ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="m15 18-6-6 6-6" />
            </svg>
          </button>

          {/* Header */}
          <div className="p-6 pb-4 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 bg-blue-600 rounded-xl flex items-center justify-center text-white font-black text-lg shadow-lg">S</div>
              <div>
                <h1 className="text-lg font-black tracking-tight text-slate-900">SeatMint</h1>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Venue Designer</span>
              </div>
            </div>
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto p-6 pt-4">
            {/* Preset Selector */}
            <div className="mb-6">
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">Venue Template</label>
              <select
                onChange={(e) => applyPreset(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="amphitheater">Amphitheater (Mixed)</option>
                <option value="stadium">Stadium (Fanned)</option>
                <option value="club">Club (Rectangular)</option>
              </select>
            </div>

            {/* Stage Width */}
            <div className="mb-6">
              <div className="flex justify-between text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">
                <span>Stage Width</span>
                <span className="text-blue-600">{stageWidth}m</span>
              </div>
              <input
                type="range"
                min="10"
                max="80"
                value={stageWidth}
                onChange={(e) => setStageWidth(parseInt(e.target.value))}
                className="w-full accent-blue-600"
              />
            </div>

            {/* Sections */}
            <div className="mb-6">
              <div className="flex justify-between items-center mb-3">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Seating Sections</span>
                <button onClick={addTier} className="text-blue-600 text-xs font-bold hover:bg-blue-50 px-2 py-1 rounded-lg transition">
                  + Add
                </button>
              </div>

              <div className="space-y-3">
                {tiers.map((tier, i) => (
                  <div key={tier.id} className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                    <div className="flex justify-between items-center mb-3 pb-3 border-b border-slate-200">
                      <input
                        type="text"
                        value={tier.name}
                        onChange={(e) => updateTier(i, { name: e.target.value })}
                        className="font-bold text-sm bg-transparent border-none focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 rounded px-2 py-1 -ml-2"
                      />
                      <button
                        onClick={() => removeTier(i)}
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Layout</label>
                        <select
                          value={tier.layout}
                          onChange={(e) => updateTier(i, { layout: e.target.value as 'fanned' | 'rectangular' })}
                          className="w-full border border-slate-200 rounded-lg px-2 py-2 text-xs font-semibold"
                        >
                          <option value="fanned">Fanned</option>
                          <option value="rectangular">Rectangular</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Price (ADA)</label>
                        <input
                          type="number"
                          value={tier.price}
                          onChange={(e) => updateTier(i, { price: parseInt(e.target.value) || 0 })}
                          className="w-full border border-slate-200 rounded-lg px-2 py-2 text-xs font-semibold"
                        />
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase mb-1">
                          <span>Depth</span>
                          <span className="text-blue-600">{tier.depth}m</span>
                        </div>
                        <input
                          type="range"
                          min="10"
                          max="80"
                          value={tier.depth}
                          onChange={(e) => updateTier(i, { depth: parseInt(e.target.value) })}
                          className="w-full accent-blue-600"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase mb-1">
                          <span>Incline</span>
                          <span className="text-blue-600">{Math.round(tier.pitch * 100)}%</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="0.25"
                          step="0.01"
                          value={tier.pitch}
                          onChange={(e) => updateTier(i, { pitch: parseFloat(e.target.value) })}
                          className="w-full accent-blue-600"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase mb-1">
                          <span>Spread</span>
                          <span className="text-blue-600">{tier.width}{tier.layout === 'fanned' ? '°' : 'm'}</span>
                        </div>
                        <input
                          type="range"
                          min="20"
                          max="240"
                          value={tier.width}
                          onChange={(e) => updateTier(i, { width: parseInt(e.target.value) })}
                          className="w-full accent-blue-600"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Obstructions */}
            <div>
              <div className="flex justify-between items-center mb-3">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Obstructions</span>
                <button onClick={addObstruction} className="text-blue-600 text-xs font-bold hover:bg-blue-50 px-2 py-1 rounded-lg transition">
                  + Add Pillar
                </button>
              </div>
              {obstructions.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-4">No obstructions added</p>
              ) : (
                <div className="space-y-3">
                  {obstructions.map((obs, j) => (
                    <div key={j} className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                      <div className="flex justify-between items-center mb-3">
                        <span className="font-bold text-sm text-slate-700">Pillar {j + 1}</span>
                        <button
                          onClick={() => setObstructions(prev => prev.filter((_, i) => i !== j))}
                          className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">X: {obs.x}m</label>
                          <input
                            type="range"
                            min="-100"
                            max="100"
                            value={obs.x}
                            onChange={(e) => setObstructions(prev => prev.map((o, i) => i === j ? { ...o, x: parseInt(e.target.value) } : o))}
                            className="w-full accent-blue-600"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Z: {obs.z}m</label>
                          <input
                            type="range"
                            min="0"
                            max="300"
                            value={obs.z}
                            onChange={(e) => setObstructions(prev => prev.map((o, i) => i === j ? { ...o, z: parseInt(e.target.value) } : o))}
                            className="w-full accent-blue-600"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Buy Panel */}
      {selectedSeat && (
        <div className="absolute top-0 right-0 h-full w-[420px] max-w-full bg-white shadow-2xl z-50 overflow-y-auto">
          <div className="p-8 pt-6 min-h-full flex flex-col">
            <button
              onClick={closeBuyPanel}
              className="absolute top-5 right-5 w-10 h-10 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <div className="text-center mb-8 pt-8">
              <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-5">
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
                </svg>
              </div>
              <h3 className="text-2xl font-black text-slate-900 mb-2">Confirm Selection</h3>
              <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">
                {selectedSeat.tier.name} - {selectedSeat.label.row} - {selectedSeat.label.seat}
              </p>
            </div>

            <div className="bg-gradient-to-br from-slate-50 to-slate-100 border border-slate-200 rounded-2xl p-6 mb-6">
              <div className="flex items-center gap-4 mb-4 pb-4 border-b border-slate-200">
                <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
                  </svg>
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Your Seat</div>
                  <div className="text-lg font-black text-slate-900">
                    {selectedSeat.tier.name} - {selectedSeat.label.row} - {selectedSeat.label.seat}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500 font-medium">Ticket Price</span>
                  <span className="font-bold text-slate-900">{selectedSeat.tier.price} ADA</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500 font-medium">Platform Fee</span>
                  <span className="font-semibold text-slate-600">2 ADA</span>
                </div>
              </div>
            </div>

            <div className="bg-slate-900 text-white rounded-2xl p-5 mb-8">
              <div className="flex justify-between items-center">
                <span className="font-bold text-slate-300">Total</span>
                <span className="text-2xl font-black">{selectedSeat.tier.price + 2} ADA</span>
              </div>
            </div>

            <div className="flex gap-3 mt-auto">
              <button
                onClick={closeBuyPanel}
                className="flex-1 px-6 py-4 rounded-xl font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  alert('In production, this would submit to your Cardano wallet for signing.');
                  closeBuyPanel();
                }}
                className="flex-1 px-6 py-4 rounded-xl font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-lg transition"
              >
                Mint Ticket
              </button>
            </div>

            <p className="text-center text-xs text-slate-400 mt-6">
              This will create an NFT ticket on the Cardano blockchain
            </p>
          </div>
        </div>
      )}

      {/* Onboarding Overlay */}
      {showOnboarding && (
        <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm z-[200] flex items-center justify-center">
          <div className="bg-white rounded-2xl p-8 max-w-md text-center shadow-2xl">
            <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-5">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h3 className="text-xl font-black text-slate-900 mb-2">Welcome to Venue Designer</h3>
            <p className="text-slate-500 text-sm mb-6">
              Design your venue layout with sections, stage, and seating. Switch to <strong>Preview</strong> mode to test the buyer experience.
            </p>
            <div className="flex flex-col gap-3 text-left bg-slate-50 rounded-xl p-4 mb-6">
              <div className="flex items-center gap-3 text-sm">
                <span className="w-6 h-6 bg-blue-600 text-white rounded-lg flex items-center justify-center text-xs font-bold">1</span>
                <span className="text-slate-600">Configure sections in the sidebar</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="w-6 h-6 bg-blue-600 text-white rounded-lg flex items-center justify-center text-xs font-bold">2</span>
                <span className="text-slate-600">Drag to orbit around your venue</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="w-6 h-6 bg-blue-600 text-white rounded-lg flex items-center justify-center text-xs font-bold">3</span>
                <span className="text-slate-600">Click seats to view from that position</span>
              </div>
            </div>
            <button
              onClick={dismissOnboarding}
              className="w-full py-4 rounded-xl font-bold text-white bg-blue-600 hover:bg-blue-700 transition shadow-lg"
            >
              Get Started
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
