import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, Skull, Play, RotateCcw, Move } from 'lucide-react';

// --- Constants ---
const LANE_WIDTH = 4;
const LANES_COUNT = 15;
const WORLD_WIDTH = 30;
const ROAD_START = 4;
const ROAD_END = LANES_COUNT - 4;
const VEHICLE_SPEEDS = [0.1, 0.15, 0.2, 0.25];

// --- Types ---
enum VehicleType {
  NORMAL,
  AGGRESSIVE, // Speeds up near player
  INTERCEPTOR, // Tries to match player X
  SPEEDSTER    // Constant high speed
}

interface Vehicle {
  mesh: THREE.Object3D;
  speed: number;
  baseSpeed: number;
  direction: number;
  lane: number;
  type: VehicleType;
}

// --- Audio Synthesis ---
class SoundManager {
  private ctx: AudioContext | null = null;

  private init() {
    if (!this.ctx) this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }

  playMove() {
    this.init();
    const osc = this.ctx!.createOscillator();
    const gain = this.ctx!.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(150, this.ctx!.currentTime);
    osc.frequency.exponentialRampToValueAtTime(10, this.ctx!.currentTime + 0.1);
    gain.gain.setValueAtTime(0.05, this.ctx!.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx!.currentTime + 0.1);
    osc.connect(gain);
    gain.connect(this.ctx!.destination);
    osc.start();
    osc.stop(this.ctx!.currentTime + 0.1);
  }

  playCrash() {
    this.init();
    const osc = this.ctx!.createOscillator();
    const gain = this.ctx!.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(100, this.ctx!.currentTime);
    osc.frequency.exponentialRampToValueAtTime(0.01, this.ctx!.currentTime + 0.5);
    gain.gain.setValueAtTime(0.2, this.ctx!.currentTime);
    gain.gain.linearRampToValueAtTime(0, this.ctx!.currentTime + 0.5);
    osc.connect(gain);
    gain.connect(this.ctx!.destination);
    osc.start();
    osc.stop(this.ctx!.currentTime + 0.5);
  }

  playWin() {
    this.init();
    const now = this.ctx!.currentTime;
    [440, 554, 659, 880].forEach((freq, i) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.frequency.setValueAtTime(freq, now + i * 0.1);
      gain.gain.setValueAtTime(0.1, now + i * 0.1);
      gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.1 + 0.3);
      osc.connect(gain);
      gain.connect(this.ctx!.destination);
      osc.start(now + i * 0.1);
      osc.stop(now + i * 0.1 + 0.3);
    });
  }
}

const sounds = new SoundManager();

const App = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [gameState, setGameState] = useState<'IDLE' | 'PLAYING' | 'WON' | 'LOST'>('IDLE');
  const [score, setScore] = useState(0);
  const [highScores, setHighScores] = useState<any[]>([]);
  
  // Three.js Refs
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const playerRef = useRef<THREE.Mesh | null>(null);
  const vehiclesRef = useRef<Vehicle[]>([]);
  const frameIdRef = useRef<number | null>(null);
  
  const moveRef = useRef({ forward: false, backward: false, left: false, right: false });

  // Initialize Scene
  useEffect(() => {
    if (!containerRef.current) return;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0a);
    sceneRef.current = scene;

    // Camera (Orthographic for that isometric look)
    const aspect = window.innerWidth / window.innerHeight;
    const d = 15;
    const camera = new THREE.OrthographicCamera(-d * aspect, d * aspect, d, -d, 1, 1000);
    camera.position.set(20, 20, 20);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1);
    dirLight.position.set(10, 20, 10);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    scene.add(dirLight);

    // World Floor (Grass and Road)
    for (let i = 0; i < LANES_COUNT; i++) {
        const isRoad = i >= ROAD_START && i <= ROAD_END;
        const color = isRoad ? 0x333333 : 0x228b22;
        const width = 100;
        const height = 0.5;
        const depth = LANE_WIDTH;
        
        const geometry = new THREE.BoxGeometry(width, height, depth);
        const material = new THREE.MeshStandardMaterial({ color });
        const floor = new THREE.Mesh(geometry, material);
        floor.position.set(0, -0.25, i * LANE_WIDTH - (LANES_COUNT * LANE_WIDTH) / 2);
        floor.receiveShadow = true;
        scene.add(floor);

        // Add road stripes
        if (isRoad) {
            const laneStripes = new THREE.Group();
            for (let x = -width/2; x < width/2; x += 6) {
                const stripeGeo = new THREE.BoxGeometry(2, 0.1, 0.2);
                const stripeMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
                const stripe = new THREE.Mesh(stripeGeo, stripeMat);
                stripe.position.set(x, 0.05, 0);
                laneStripes.add(stripe);
            }
            laneStripes.position.z = floor.position.z;
            scene.add(laneStripes);
        }
    }

    // Player (Human Body)
    const playerGroup = new THREE.Group();
    
    // Torso
    const torso = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 1, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x3b82f6 }) // Blue shirt
    );
    torso.position.y = 1.1;
    torso.castShadow = true;
    playerGroup.add(torso);

    // Head
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.5, 0.5),
      new THREE.MeshStandardMaterial({ color: 0xffdbac }) // Skin tone
    );
    head.position.y = 1.85;
    head.castShadow = true;
    playerGroup.add(head);

    // Legs
    const legGeo = new THREE.BoxGeometry(0.3, 0.8, 0.3);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x1f2937 }); // Dark pants
    
    const leftLeg = new THREE.Mesh(legGeo, legMat);
    leftLeg.position.set(-0.2, 0.4, 0);
    leftLeg.castShadow = true;
    playerGroup.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeo, legMat);
    rightLeg.position.set(0.2, 0.4, 0);
    rightLeg.castShadow = true;
    playerGroup.add(rightLeg);

    // Arms
    const armGeo = new THREE.BoxGeometry(0.25, 0.8, 0.25);
    const armMat = new THREE.MeshStandardMaterial({ color: 0xffdbac });
    
    const leftArm = new THREE.Mesh(armGeo, armMat);
    leftArm.position.set(-0.55, 1.2, 0);
    leftArm.castShadow = true;
    playerGroup.add(leftArm);

    const rightArm = new THREE.Mesh(armGeo, armMat);
    rightArm.position.set(0.55, 1.2, 0);
    rightArm.castShadow = true;
    playerGroup.add(rightArm);

    playerGroup.position.set(0, 0, -(LANES_COUNT * LANE_WIDTH) / 2 + 2);
    scene.add(playerGroup);
    (playerRef.current as any) = playerGroup;

    // Handle Resize
    const handleResize = () => {
      if (!rendererRef.current || !cameraRef.current) return;
      const aspect = window.innerWidth / window.innerHeight;
      const d = 15;
      cameraRef.current.left = -d * aspect;
      cameraRef.current.right = d * aspect;
      cameraRef.current.top = d;
      cameraRef.current.bottom = -d;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
    };
  }, []);

  // Game Loop
  useEffect(() => {
    const update = () => {
      if (!sceneRef.current || !cameraRef.current || !rendererRef.current || !playerRef.current) return;

      if (gameState === 'PLAYING') {
        const player = playerRef.current;
        const speed = 0.15;
        const isMoving = moveRef.current.forward || moveRef.current.backward || moveRef.current.left || moveRef.current.right;

        // Player Movement
        if (moveRef.current.forward) {
            player.position.z += speed;
            player.rotation.y = 0;
        }
        if (moveRef.current.backward) {
            player.position.z -= speed;
            player.rotation.y = Math.PI;
        }
        if (moveRef.current.left) {
            player.position.x += speed;
            player.rotation.y = Math.PI / 2;
        }
        if (moveRef.current.right) {
            player.position.x -= speed;
            player.rotation.y = -Math.PI / 2;
        }

        // Animated walking
        if (isMoving) {
            const time = Date.now() * 0.01;
            const swing = Math.sin(time) * 0.5;
            
            // Access children (leftLeg: 2, rightLeg: 3, leftArm: 4, rightArm: 5 as per order of addition)
            const leftLeg = player.children[2];
            const rightLeg = player.children[3];
            const leftArm = player.children[4];
            const rightArm = player.children[5];

            if (leftLeg) leftLeg.rotation.x = swing;
            if (rightLeg) rightLeg.rotation.x = -swing;
            if (leftArm) leftArm.rotation.x = -swing;
            if (rightArm) rightArm.rotation.x = swing;
        } else {
             player.children.forEach((child: any) => {
                if (child.rotation) child.rotation.x = 0;
             });
        }

        // Keep player in bounds
        player.position.x = Math.max(-20, Math.min(20, player.position.x));
        player.position.z = Math.max(-(LANES_COUNT * LANE_WIDTH) / 2, Math.min((LANES_COUNT * LANE_WIDTH) / 2, player.position.z));

        // Camera follow (soft)
        cameraRef.current.position.z = player.position.z + 20;
        cameraRef.current.position.x = player.position.x + 20;
        cameraRef.current.lookAt(player.position.x, 0, player.position.z);

        // Update Vehicles
        vehiclesRef.current.forEach((v: Vehicle) => {
          // AI Behavior Logic
          const player = playerRef.current!;
          const distToPlayerX = player.position.x - v.mesh.position.x;
          const distToPlayerZ = player.position.z - v.mesh.position.z;

          switch(v.type) {
            case VehicleType.AGGRESSIVE:
              // Speed up if player is in front and nearby
              if (Math.abs(distToPlayerZ) < 5 && Math.sign(v.direction) === Math.sign(distToPlayerX)) {
                v.speed = THREE.MathUtils.lerp(v.speed, v.baseSpeed * 2.5, 0.1);
              } else {
                v.speed = THREE.MathUtils.lerp(v.speed, v.baseSpeed, 0.05);
              }
              break;
            case VehicleType.INTERCEPTOR:
              // Slightly steer towards player's X if within activation range
              if (Math.abs(distToPlayerZ) < 10) {
                const steer = Math.sign(distToPlayerX) * 0.02;
                v.mesh.position.x += steer; // Additional drift towards player
              }
              break;
            case VehicleType.SPEEDSTER:
              // Just keeps a slightly higher constant speed
              v.speed = v.baseSpeed * 1.5;
              break;
          }

          v.mesh.position.x += v.speed * v.direction;
          
          // Warp handling
          if (v.mesh.position.x > 50) v.mesh.position.x = -50;
          if (v.mesh.position.x < -50) v.mesh.position.x = 50;

          // Collision Detection
          const dx = player.position.x - v.mesh.position.x;
          const dz = player.position.z - v.mesh.position.z;
          const limitX = 2;
          const limitZ = 1.5;
          if (Math.abs(dx) < limitX && Math.abs(dz) < limitZ) {
            setGameState('LOST');
            sounds.playCrash();
          }
        });

  // Win Condition
        const winThreshold = (LANES_COUNT * LANE_WIDTH) / 2 - 2;
        if (player.position.z > winThreshold) {
          setGameState('WON');
          sounds.playWin();
          const newScore = score + 1;
          setScore(newScore);
          submitScore(newScore);
        }
      }

      rendererRef.current.render(sceneRef.current, cameraRef.current);
      frameIdRef.current = requestAnimationFrame(update);
    };

    frameIdRef.current = requestAnimationFrame(update);
    return () => {
      if (frameIdRef.current) cancelAnimationFrame(frameIdRef.current);
    };
  }, [gameState]);

  // Handle Controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (gameState === 'PLAYING') sounds.playMove();
      switch (e.key.toLowerCase()) {
        case 'w': case 'arrowup': moveRef.current.forward = true; break;
        case 's': case 'arrowdown': moveRef.current.backward = true; break;
        case 'a': case 'arrowleft': moveRef.current.left = true; break;
        case 'd': case 'arrowright': moveRef.current.right = true; break;
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      switch (e.key.toLowerCase()) {
        case 'w': case 'arrowup': moveRef.current.forward = false; break;
        case 's': case 'arrowdown': moveRef.current.backward = false; break;
        case 'a': case 'arrowleft': moveRef.current.left = false; break;
        case 'd': case 'arrowright': moveRef.current.right = false; break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  const spawnVehicles = () => {
    if (!sceneRef.current) return;
    
    // Clear existing
    vehiclesRef.current.forEach((v: Vehicle) => sceneRef.current?.remove(v.mesh));
    vehiclesRef.current = [];

    const carGeometries = {
      body: new THREE.BoxGeometry(4, 1.2, 2.2),
      roof: new THREE.BoxGeometry(2.2, 0.8, 1.8),
      wheel: new THREE.CylinderGeometry(0.4, 0.4, 0.4, 16),
      light: new THREE.BoxGeometry(0.2, 0.3, 0.5)
    };

    for (let i = ROAD_START; i <= ROAD_END; i++) {
        const laneZ = i * LANE_WIDTH - (LANES_COUNT * LANE_WIDTH) / 2;
        const direction = Math.random() > 0.5 ? 1 : -1;
        const baseLaneSpeed = VEHICLE_SPEEDS[Math.floor(Math.random() * VEHICLE_SPEEDS.length)];
        const count = 3 + Math.floor(Math.random() * 3);

        const laneRand = Math.random();
        const laneType: VehicleType = laneRand > 0.9 ? VehicleType.SPEEDSTER :
                                     laneRand > 0.8 ? VehicleType.AGGRESSIVE : 
                                     laneRand > 0.7 ? VehicleType.INTERCEPTOR : 
                                     VehicleType.NORMAL;

        for (let j = 0; j < count; j++) {
            const vehicleGroup = new THREE.Group();
            const currentType: VehicleType = j === 0 && Math.random() > 0.8 ? VehicleType.INTERCEPTOR : laneType;
            
            let color = new THREE.Color(`hsl(${Math.random() * 360}, 70%, 50%)`);
            if (currentType === VehicleType.INTERCEPTOR) color = new THREE.Color(0xff3300);
            if (currentType === VehicleType.AGGRESSIVE) color = new THREE.Color(0xffaa00);
            if (currentType === VehicleType.SPEEDSTER) color = new THREE.Color(0x00ccff);

            // Detailed Car Construction
            const body = new THREE.Mesh(carGeometries.body, new THREE.MeshStandardMaterial({ color, roughness: 0.3 }));
            body.castShadow = true;
            vehicleGroup.add(body);

            const roof = new THREE.Mesh(carGeometries.roof, new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.5 }));
            roof.position.set(-0.2, 1, 0);
            roof.castShadow = true;
            vehicleGroup.add(roof);

            // Windows
            const windowMat = new THREE.MeshStandardMaterial({ color: 0x66ccff, transparent: true, opacity: 0.6 });
            const frontWindow = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.6, 1.6), windowMat);
            frontWindow.position.set(0.9, 1, 0);
            vehicleGroup.add(frontWindow);

            // Wheels
            const wheelMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
            const wheelPositions = [
                [1.2, -0.4, 0.9], [1.2, -0.4, -0.9],
                [-1.2, -0.4, 0.9], [-1.2, -0.4, -0.9]
            ];
            wheelPositions.forEach(pos => {
                const wheel = new THREE.Mesh(carGeometries.wheel, wheelMat);
                wheel.rotation.x = Math.PI / 2;
                wheel.position.set(pos[0], pos[1], pos[2]);
                vehicleGroup.add(wheel);
            });

            // Headlights
            const lightMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffcc, emissiveIntensity: 2 });
            const leftLight = new THREE.Mesh(carGeometries.light, lightMat);
            leftLight.position.set(2, 0.2, 0.7);
            const rightLight = leftLight.clone();
            rightLight.position.z = -0.7;
            vehicleGroup.add(leftLight, rightLight);

            vehicleGroup.position.set(-50 + (100 / count) * j + Math.random() * 10, 0.8, laneZ);
            if (direction < 0) vehicleGroup.rotation.y = Math.PI;

            sceneRef.current.add(vehicleGroup);
            vehiclesRef.current.push({ 
                mesh: vehicleGroup, 
                speed: baseLaneSpeed, 
                baseSpeed: baseLaneSpeed,
                direction, 
                lane: i,
                type: currentType 
            });
        }
    }
  };

  const startGame = () => {
    if (!playerRef.current) return;
    playerRef.current.position.set(0, 0, -(LANES_COUNT * LANE_WIDTH) / 2 + 2);
    playerRef.current.rotation.set(0, 0, 0);
    setGameState('PLAYING');
    spawnVehicles();
    fetchScores();
  };

  const fetchScores = async () => {
    try {
      const res = await fetch('/api/scores');
      if (res.ok) {
        const data = await res.json();
        setHighScores(data);
      }
    } catch (e) {
      console.error("Failed to fetch scores", e);
    }
  };

  const submitScore = async (finalScore: number) => {
    try {
      await fetch('/api/scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player_name: 'Hero', score: finalScore })
      });
      fetchScores();
    } catch (e) {
      console.error("Failed to submit score", e);
    }
  };

  const resetGame = () => {
    setScore(0);
    startGame();
  };

  return (
    <div className="relative w-full h-screen font-sans">
      <div ref={containerRef} className="absolute inset-0" />

      {/* --- UI Overlays --- */}
      <div className="absolute top-8 left-8 z-10">
        <h1 className="text-4xl font-display text-white tracking-widest drop-shadow-[0_2px_10px_rgba(0,0,0,0.5)]">
          BUSY ROAD DASH
        </h1>
        <div className="mt-2 flex items-center gap-4 text-zinc-400 font-medium">
          <span className="flex items-center gap-2 bg-zinc-900/80 px-3 py-1 rounded-full border border-zinc-700/50">
            <Trophy className="w-4 h-4 text-yellow-500" />
            SCORE: {score}
          </span>
          <span className="flex items-center gap-2 bg-zinc-900/80 px-3 py-1 rounded-full border border-zinc-700/50">
            <Move className="w-4 h-4 text-sky-400" />
            WASD TO MOVE
          </span>
        </div>
      </div>

      <AnimatePresence>
        {gameState === 'IDLE' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-20"
          >
            <div className="text-center p-12 bg-zinc-900 border-2 border-zinc-800 rounded-3xl shadow-2xl skew-x-[-2deg]">
              <h2 className="text-6xl font-display text-white mb-4">READY?</h2>
              <p className="text-zinc-400 mb-8 max-w-xs mx-auto">
                Cross the road safely. Don't let the traffic stop your journey.
              </p>
              <button 
                onClick={startGame}
                className="group relative px-8 py-4 bg-lime-500 hover:bg-lime-400 text-black font-bold text-xl rounded-xl transition-all transform hover:scale-105 active:scale-95 flex items-center gap-3 mx-auto shadow-[0_0_20px_rgba(132,204,22,0.3)]"
              >
                <Play className="w-6 h-6 fill-current" />
                START DASH
              </button>
            </div>
          </motion.div>
        )}

        {gameState === 'LOST' && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="absolute inset-0 flex items-center justify-center bg-red-950/40 backdrop-blur-md z-30"
          >
            <div className="text-center p-12 bg-zinc-900 border-b-8 border-red-600 rounded-t-3xl shadow-2xl">
              <Skull className="w-20 h-20 text-red-500 mx-auto mb-6" />
              <h2 className="text-6xl font-display text-white mb-2">SPLAT!</h2>
              <p className="text-red-400 mb-8 font-medium uppercase tracking-widest text-sm">Traffic was too much this time.</p>
              <div className="flex flex-col gap-3">
                <button 
                  onClick={startGame}
                  className="px-8 py-4 bg-white hover:bg-zinc-200 text-black font-bold text-xl rounded-xl transition-all flex items-center justify-center gap-3"
                >
                  <RotateCcw className="w-6 h-6" />
                  TRY AGAIN
                </button>
                <button 
                  onClick={() => setGameState('IDLE')}
                  className="px-8 py-4 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold text-lg rounded-xl transition-all"
                >
                  MAIN MENU
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {gameState === 'WON' && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute inset-0 flex items-center justify-center bg-lime-950/40 backdrop-blur-md z-30"
          >
            <div className="text-center p-12 bg-zinc-900 border-b-8 border-lime-500 rounded-t-3xl shadow-2xl">
              <Trophy className="w-20 h-20 text-lime-500 mx-auto mb-6 animate-bounce" />
              <h2 className="text-6xl font-display text-white mb-2">MADE IT!</h2>
              <p className="text-lime-400 mb-8 font-medium uppercase tracking-widest text-sm">Successfully reached the safe zone.</p>
              <div className="flex flex-col gap-3">
                <button 
                  onClick={startGame}
                  className="px-8 py-4 bg-lime-500 hover:bg-lime-400 text-black font-bold text-xl rounded-xl transition-all flex items-center justify-center gap-3"
                >
                  NEXT LEVEL
                </button>
                <div className="text-zinc-500 text-sm mt-4 font-mono">Current Streak: {score}</div>
                {highScores.length > 0 && (
                  <div className="mt-4 p-4 bg-black/40 rounded-xl text-left">
                    <div className="text-[10px] text-zinc-500 uppercase font-bold mb-2">Internal Top 5</div>
                    {highScores.map((s, idx) => (
                      <div key={idx} className="flex justify-between text-xs font-mono text-zinc-400">
                        <span>{s.player_name}</span>
                        <span>{s.score}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* --- Controls Guide --- */}
      <div className="absolute bottom-8 right-8 z-10 flex gap-4">
        <div className="flex flex-col items-center gap-1">
            <kbd className="px-3 py-2 bg-zinc-800 rounded border border-zinc-700 text-zinc-300 font-bold">W</kbd>
            <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">Forward</span>
        </div>
        <div className="flex flex-col items-center gap-1">
            <div className="flex gap-1">
                <kbd className="px-3 py-2 bg-zinc-800 rounded border border-zinc-700 text-zinc-300 font-bold">A</kbd>
                <kbd className="px-3 py-2 bg-zinc-800 rounded border border-zinc-700 text-zinc-300 font-bold">S</kbd>
                <kbd className="px-3 py-2 bg-zinc-800 rounded border border-zinc-700 text-zinc-300 font-bold">D</kbd>
            </div>
            <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">Navigate</span>
        </div>
      </div>
    </div>
  );
};

export default App;
