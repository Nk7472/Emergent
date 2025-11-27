import { useState, useEffect, useRef } from 'react';
import '@/App.css';
import axios from 'axios';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// IndexedDB Manager
class AssetCache {
  constructor() {
    this.dbName = 'BoostBallArenaCache';
    this.storeName = 'assets';
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'url' });
        }
      };
    });
  }

  async hasAsset(url) {
    if (!this.db) await this.init();
    return new Promise((resolve) => {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(url);
      request.onsuccess = () => resolve(!!request.result);
      request.onerror = () => resolve(false);
    });
  }

  async getAsset(url) {
    if (!this.db) await this.init();
    return new Promise((resolve) => {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(url);
      request.onsuccess = () => resolve(request.result?.data);
      request.onerror = () => resolve(null);
    });
  }

  async storeAsset(url, data) {
    if (!this.db) await this.init();
    return new Promise((resolve) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.put({ url, data, timestamp: Date.now() });
      request.onsuccess = () => resolve(true);
      request.onerror = () => resolve(false);
    });
  }
}

const assetCache = new AssetCache();

function App() {
  const [gameState, setGameState] = useState('loading'); // loading, lobby, playing, matchmaking
  const [player, setPlayer] = useState(null);
  const [customization, setCustomization] = useState(null);
  const [score, setScore] = useState({ player: 0, opponent: 0 });
  const [gameTime, setGameTime] = useState(300);
  const [boost, setBoost] = useState(100);
  const canvasRef = useRef(null);
  const gameRef = useRef(null);

  useEffect(() => {
    initPlayer();
  }, []);

  const initPlayer = async () => {
    try {
      await assetCache.init();
      
      const email = `player_${Date.now()}@game.com`;
      const username = `Player${Math.floor(Math.random() * 9999)}`;
      
      try {
        const response = await axios.get(`${API}/players/email/${email}`);
        setPlayer(response.data);
      } catch (error) {
        const createResponse = await axios.post(`${API}/players`, { email, username });
        setPlayer(createResponse.data);
      }
      
      setGameState('lobby');
    } catch (error) {
      console.error('Player init error:', error);
      setGameState('lobby');
    }
  };

  const loadCustomization = async (playerId) => {
    try {
      const response = await axios.get(`${API}/customization/${playerId}`);
      setCustomization(response.data);
    } catch (error) {
      console.error('Failed to load customization:', error);
    }
  };

  const updateCustomization = async (updates) => {
    if (!player) return;
    try {
      const response = await axios.patch(`${API}/customization/${player.id}`, updates);
      setCustomization(response.data);
    } catch (error) {
      console.error('Failed to update customization:', error);
    }
  };

  const startMatchmaking = () => {
    setGameState('matchmaking');
    setTimeout(() => {
      setGameState('playing');
    }, 3000);
  };

  useEffect(() => {
    if (gameState === 'playing' && canvasRef.current && !gameRef.current) {
      initGame();
    }
    
    return () => {
      if (gameRef.current) {
        gameRef.current.cleanup();
        gameRef.current = null;
      }
    };
  }, [gameState]);

  const initGame = () => {
    const canvas = canvasRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB);
    scene.fog = new THREE.Fog(0x87CEEB, 50, 200);

    // Camera
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 15, 25);
    camera.lookAt(0, 0, 0);

    // Renderer
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Physics World
    const world = new CANNON.World();
    world.gravity.set(0, -20, 0);
    world.broadphase = new CANNON.NaiveBroadphase();
    world.solver.iterations = 10;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(20, 40, 20);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 100;
    directionalLight.shadow.camera.left = -50;
    directionalLight.shadow.camera.right = 50;
    directionalLight.shadow.camera.top = 50;
    directionalLight.shadow.camera.bottom = -50;
    scene.add(directionalLight);

    // Stadium floor
    const floorGeometry = new THREE.PlaneGeometry(100, 60);
    const floorMaterial = new THREE.MeshStandardMaterial({
      color: 0x2ECC71,
      roughness: 0.8,
      metalness: 0.2
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const floorShape = new CANNON.Plane();
    const floorBody = new CANNON.Body({ mass: 0 });
    floorBody.addShape(floorShape);
    floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    world.addBody(floorBody);

    // Field lines
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0xFFFFFF, linewidth: 2 });
    const centerCircleGeometry = new THREE.BufferGeometry();
    const centerCirclePoints = [];
    for (let i = 0; i <= 64; i++) {
      const angle = (i / 64) * Math.PI * 2;
      centerCirclePoints.push(new THREE.Vector3(Math.cos(angle) * 8, 0.1, Math.sin(angle) * 8));
    }
    centerCircleGeometry.setFromPoints(centerCirclePoints);
    const centerCircle = new THREE.Line(centerCircleGeometry, lineMaterial);
    scene.add(centerCircle);

    // Goals
    const createGoal = (x, z) => {
      const goalGroup = new THREE.Group();
      
      const postMaterial = new THREE.MeshStandardMaterial({ color: 0xFFFFFF });
      const postGeometry = new THREE.CylinderGeometry(0.3, 0.3, 6);
      
      const leftPost = new THREE.Mesh(postGeometry, postMaterial);
      leftPost.position.set(x, 3, z - 6);
      leftPost.castShadow = true;
      goalGroup.add(leftPost);
      
      const rightPost = new THREE.Mesh(postGeometry, postMaterial);
      rightPost.position.set(x, 3, z + 6);
      rightPost.castShadow = true;
      goalGroup.add(rightPost);
      
      const crossbar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.3, 12),
        postMaterial
      );
      crossbar.rotation.z = Math.PI / 2;
      crossbar.position.set(x, 6, z);
      crossbar.castShadow = true;
      goalGroup.add(crossbar);
      
      const netGeometry = new THREE.PlaneGeometry(12, 6);
      const netMaterial = new THREE.MeshBasicMaterial({
        color: 0xFFFFFF,
        wireframe: true,
        transparent: true,
        opacity: 0.5
      });
      const net = new THREE.Mesh(netGeometry, netMaterial);
      net.position.set(x - 2, 3, z);
      net.rotation.y = x > 0 ? Math.PI / 2 : -Math.PI / 2;
      goalGroup.add(net);
      
      scene.add(goalGroup);
      
      // Goal physics trigger
      const goalShape = new CANNON.Box(new CANNON.Vec3(2, 6, 6));
      const goalBody = new CANNON.Body({ mass: 0, isTrigger: true });
      goalBody.addShape(goalShape);
      goalBody.position.set(x, 3, z);
      world.addBody(goalBody);
      
      return { mesh: goalGroup, body: goalBody };
    };

    const goal1 = createGoal(-45, 0);
    const goal2 = createGoal(45, 0);

    // Ball
    const ballGeometry = new THREE.SphereGeometry(1, 32, 32);
    const ballMaterial = new THREE.MeshStandardMaterial({
      color: 0xFFFFFF,
      emissive: 0x3B82F6,
      emissiveIntensity: 0.2,
      roughness: 0.3,
      metalness: 0.6
    });
    const ballMesh = new THREE.Mesh(ballGeometry, ballMaterial);
    ballMesh.castShadow = true;
    ballMesh.position.set(0, 2, 0);
    scene.add(ballMesh);

    const ballShape = new CANNON.Sphere(1);
    const ballBody = new CANNON.Body({
      mass: 1,
      shape: ballShape,
      material: new CANNON.Material({ friction: 0.3, restitution: 0.8 })
    });
    ballBody.position.set(0, 2, 0);
    ballBody.linearDamping = 0.1;
    ballBody.angularDamping = 0.1;
    world.addBody(ballBody);

    // Player car
    const carGroup = new THREE.Group();
    const carBodyGeometry = new THREE.BoxGeometry(2, 1, 4);
    const carColor = customization?.body_color || '#3B82F6';
    const carBodyMaterial = new THREE.MeshStandardMaterial({
      color: carColor,
      roughness: 0.4,
      metalness: 0.7
    });
    const carBody = new THREE.Mesh(carBodyGeometry, carBodyMaterial);
    carBody.castShadow = true;
    carGroup.add(carBody);

    const carTopGeometry = new THREE.BoxGeometry(1.5, 0.6, 2);
    const carTop = new THREE.Mesh(carTopGeometry, carBodyMaterial);
    carTop.position.set(0, 0.8, -0.3);
    carTop.castShadow = true;
    carGroup.add(carTop);

    const wheelGeometry = new THREE.CylinderGeometry(0.5, 0.5, 0.3, 16);
    const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x1F2937 });
    const wheelPositions = [
      [-1, -0.5, 1.2],
      [1, -0.5, 1.2],
      [-1, -0.5, -1.2],
      [1, -0.5, -1.2]
    ];
    
    wheelPositions.forEach(pos => {
      const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(...pos);
      wheel.castShadow = true;
      carGroup.add(wheel);
    });

    carGroup.position.set(-30, 1, 0);
    scene.add(carGroup);

    const carShape = new CANNON.Box(new CANNON.Vec3(1, 0.5, 2));
    const carBodyPhysics = new CANNON.Body({
      mass: 10,
      shape: carShape,
      material: new CANNON.Material({ friction: 0.5, restitution: 0.2 })
    });
    carBodyPhysics.position.set(-30, 1, 0);
    carBodyPhysics.linearDamping = 0.3;
    carBodyPhysics.angularDamping = 0.5;
    world.addBody(carBodyPhysics);

    // Opponent car (AI)
    const opponentGroup = new THREE.Group();
    const opponentBodyMaterial = new THREE.MeshStandardMaterial({
      color: 0xEF4444,
      roughness: 0.4,
      metalness: 0.7
    });
    const opponentBody = new THREE.Mesh(carBodyGeometry, opponentBodyMaterial);
    opponentBody.castShadow = true;
    opponentGroup.add(opponentBody);

    const opponentTop = new THREE.Mesh(carTopGeometry, opponentBodyMaterial);
    opponentTop.position.set(0, 0.8, -0.3);
    opponentTop.castShadow = true;
    opponentGroup.add(opponentTop);

    wheelPositions.forEach(pos => {
      const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(...pos);
      wheel.castShadow = true;
      opponentGroup.add(wheel);
    });

    opponentGroup.position.set(30, 1, 0);
    scene.add(opponentGroup);

    const opponentBodyPhysics = new CANNON.Body({
      mass: 10,
      shape: carShape,
      material: new CANNON.Material({ friction: 0.5, restitution: 0.2 })
    });
    opponentBodyPhysics.position.set(30, 1, 0);
    opponentBodyPhysics.linearDamping = 0.3;
    opponentBodyPhysics.angularDamping = 0.5;
    world.addBody(opponentBodyPhysics);

    // Stadium walls
    const createWall = (w, h, d, x, y, z, rotY = 0) => {
      const wallGeometry = new THREE.BoxGeometry(w, h, d);
      const wallMaterial = new THREE.MeshStandardMaterial({
        color: 0x6366F1,
        transparent: true,
        opacity: 0.3
      });
      const wall = new THREE.Mesh(wallGeometry, wallMaterial);
      wall.position.set(x, y, z);
      wall.rotation.y = rotY;
      scene.add(wall);

      const wallShape = new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2));
      const wallBody = new CANNON.Body({ mass: 0 });
      wallBody.addShape(wallShape);
      wallBody.position.set(x, y, z);
      wallBody.quaternion.setFromEuler(0, rotY, 0);
      world.addBody(wallBody);
    };

    createWall(100, 10, 1, 0, 5, -30);
    createWall(100, 10, 1, 0, 5, 30);
    createWall(1, 10, 60, -50, 5, 0);
    createWall(1, 10, 60, 50, 5, 0);

    // Controls - make keys object accessible
    if (!window.gameKeys) {
      window.gameKeys = {};
    }
    const keys = window.gameKeys;
    
    const handleKeyDown = (e) => { keys[e.key.toLowerCase()] = true; };
    const handleKeyUp = (e) => { keys[e.key.toLowerCase()] = false; };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // Mobile touch controls
    let touchStartX = 0;
    let touchStartY = 0;
    let isTouching = false;

    canvas.addEventListener('touchstart', (e) => {
      isTouching = true;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    });

    canvas.addEventListener('touchmove', (e) => {
      if (!isTouching) return;
      const deltaX = e.touches[0].clientX - touchStartX;
      const deltaY = e.touches[0].clientY - touchStartY;
      
      if (Math.abs(deltaY) > 30) {
        keys['w'] = deltaY < 0;
        keys['s'] = deltaY > 0;
      }
      if (Math.abs(deltaX) > 30) {
        keys['a'] = deltaX < 0;
        keys['d'] = deltaX > 0;
      }
    });

    canvas.addEventListener('touchend', () => {
      isTouching = false;
      keys['w'] = keys['a'] = keys['s'] = keys['d'] = false;
    });

    // Game state
    let currentBoost = 100;
    let timeLeft = 300;
    let playerScore = 0;
    let opponentScore = 0;

    // Simple AI for opponent
    const updateAI = () => {
      const ballPos = ballBody.position;
      const carPos = opponentBodyPhysics.position;
      
      const dirToBall = new CANNON.Vec3(
        ballPos.x - carPos.x,
        0,
        ballPos.z - carPos.z
      );
      dirToBall.normalize();
      
      const force = 30;
      opponentBodyPhysics.applyForce(
        new CANNON.Vec3(dirToBall.x * force, 0, dirToBall.z * force),
        opponentBodyPhysics.position
      );
      
      const targetAngle = Math.atan2(dirToBall.x, dirToBall.z);
      const currentQuat = opponentBodyPhysics.quaternion;
      const targetQuat = new CANNON.Quaternion();
      targetQuat.setFromEuler(0, targetAngle, 0);
      currentQuat.slerp(targetQuat, 0.1, currentQuat);
    };

    // Goal detection
    const checkGoals = () => {
      const ballPos = ballBody.position;
      
      if (ballPos.x < -43 && Math.abs(ballPos.z) < 7 && ballPos.y < 6) {
        opponentScore++;
        setScore(prev => ({ ...prev, opponent: opponentScore }));
        resetBall();
      }
      
      if (ballPos.x > 43 && Math.abs(ballPos.z) < 7 && ballPos.y < 6) {
        playerScore++;
        setScore(prev => ({ ...prev, player: playerScore }));
        resetBall();
      }
    };

    const resetBall = () => {
      ballBody.position.set(0, 2, 0);
      ballBody.velocity.set(0, 0, 0);
      ballBody.angularVelocity.set(0, 0, 0);
      carBodyPhysics.position.set(-30, 1, 0);
      carBodyPhysics.velocity.set(0, 0, 0);
      opponentBodyPhysics.position.set(30, 1, 0);
      opponentBodyPhysics.velocity.set(0, 0, 0);
    };

    // Animation loop
    let lastTime = Date.now();
    const animate = () => {
      const currentTime = Date.now();
      const deltaTime = (currentTime - lastTime) / 1000;
      lastTime = currentTime;

      // Update physics
      world.step(1 / 60, deltaTime, 3);

      // Update car controls
      const speed = 50;
      const turnSpeed = 3;
      
      // Get forward direction from quaternion
      const getForwardVector = (quat) => {
        const forward = new CANNON.Vec3(0, 0, -1);
        quat.vmult(forward, forward);
        forward.y = 0; // Keep on ground plane
        forward.normalize();
        return forward;
      };
      
      if (keys['w'] || keys['arrowup']) {
        const forward = getForwardVector(carBodyPhysics.quaternion);
        carBodyPhysics.applyForce(new CANNON.Vec3(forward.x * speed, 0, forward.z * speed), carBodyPhysics.position);
      }
      if (keys['s'] || keys['arrowdown']) {
        const forward = getForwardVector(carBodyPhysics.quaternion);
        carBodyPhysics.applyForce(new CANNON.Vec3(-forward.x * speed, 0, -forward.z * speed), carBodyPhysics.position);
      }
      if (keys['a'] || keys['arrowleft']) {
        carBodyPhysics.angularVelocity.y = turnSpeed;
      }
      if (keys['d'] || keys['arrowright']) {
        carBodyPhysics.angularVelocity.y = -turnSpeed;
      }
      
      // Boost
      if (keys[' '] && currentBoost > 0) {
        const forward = getForwardVector(carBodyPhysics.quaternion);
        carBodyPhysics.applyForce(new CANNON.Vec3(forward.x * speed * 3, 0, forward.z * speed * 3), carBodyPhysics.position);
        currentBoost -= 0.5;
        setBoost(Math.max(0, currentBoost));
      } else if (!keys[' '] && currentBoost < 100) {
        currentBoost += 0.2;
        setBoost(Math.min(100, currentBoost));
      }

      // Update AI
      updateAI();

      // Check goals
      checkGoals();

      // Update meshes from physics
      ballMesh.position.copy(ballBody.position);
      ballMesh.quaternion.copy(ballBody.quaternion);
      
      carGroup.position.copy(carBodyPhysics.position);
      carGroup.quaternion.copy(carBodyPhysics.quaternion);
      
      opponentGroup.position.copy(opponentBodyPhysics.position);
      opponentGroup.quaternion.copy(opponentBodyPhysics.quaternion);

      // Camera follow
      const targetCamPos = new THREE.Vector3(
        carBodyPhysics.position.x - 15,
        carBodyPhysics.position.y + 10,
        carBodyPhysics.position.z + 15
      );
      camera.position.lerp(targetCamPos, 0.05);
      camera.lookAt(carGroup.position);

      renderer.render(scene, camera);
      animationId = requestAnimationFrame(animate);
    };

    let animationId = requestAnimationFrame(animate);

    // Timer
    const timerInterval = setInterval(() => {
      timeLeft--;
      setGameTime(timeLeft);
      
      if (timeLeft <= 0) {
        clearInterval(timerInterval);
        endGame();
      }
    }, 1000);

    const endGame = async () => {
      cancelAnimationFrame(animationId);
      clearInterval(timerInterval);
      
      const result = playerScore > opponentScore ? 'win' : 'loss';
      const xpEarned = playerScore * 10 + (result === 'win' ? 50 : 20);
      const coinsEarned = playerScore * 5 + (result === 'win' ? 25 : 10);
      
      if (player) {
        try {
          await axios.post(`${API}/matches`, {
            player_id: player.id,
            match_type: '1v1',
            result,
            player_goals: playerScore,
            opponent_goals: opponentScore,
            duration: 300 - timeLeft,
            xp_earned: xpEarned,
            coins_earned: coinsEarned
          });
        } catch (error) {
          console.error('Failed to save match:', error);
        }
      }
      
      setGameState('lobby');
      setScore({ player: 0, opponent: 0 });
      setGameTime(300);
      setBoost(100);
    };

    // Handle resize
    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    // Cleanup
    gameRef.current = {
      cleanup: () => {
        cancelAnimationFrame(animationId);
        clearInterval(timerInterval);
        window.removeEventListener('resize', handleResize);
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('keyup', handleKeyUp);
        renderer.dispose();
      }
    };
  };

  useEffect(() => {
    if (player && !customization) {
      loadCustomization(player.id);
    }
  }, [player]);

  return (
    <div className="App">
      {gameState === 'loading' && (
        <div className="loading-screen" data-testid="loading-screen">
          <div className="loading-content">
            <div className="spinner"></div>
            <h1>Boost Ball Arena</h1>
            <p>Loading game assets...</p>
          </div>
        </div>
      )}

      {gameState === 'lobby' && (
        <div className="lobby-screen" data-testid="lobby-screen">
          <div className="lobby-background"></div>
          <div className="lobby-content">
            <header className="lobby-header">
              <h1 className="game-title">Boost Ball Arena</h1>
              <p className="game-subtitle">Rocket League Style Car Football</p>
            </header>

            {player && (
              <div className="player-profile" data-testid="player-profile">
                <div className="profile-avatar">
                  <div className="avatar-circle">{player.username[0]}</div>
                </div>
                <div className="profile-info">
                  <h2 data-testid="player-username">{player.username}</h2>
                  <div className="profile-stats">
                    <span className="stat-item">
                      <span className="stat-label">Level</span>
                      <span className="stat-value" data-testid="player-level">{player.level}</span>
                    </span>
                    <span className="stat-item">
                      <span className="stat-label">Rank</span>
                      <span className="stat-value rank" data-testid="player-rank">{player.rank}</span>
                    </span>
                    <span className="stat-item">
                      <span className="stat-label">Wins</span>
                      <span className="stat-value" data-testid="player-wins">{player.wins}</span>
                    </span>
                  </div>
                  <div className="profile-currency">
                    <span className="currency-item">
                      <span className="currency-icon">💰</span>
                      <span data-testid="player-coins">{player.coins}</span>
                    </span>
                    <span className="currency-item">
                      <span className="currency-icon">💎</span>
                      <span data-testid="player-diamonds">{player.diamonds}</span>
                    </span>
                  </div>
                </div>
              </div>
            )}

            {customization && (
              <div className="customization-panel" data-testid="customization-panel">
                <h3>Car Customization</h3>
                <div className="custom-options">
                  <div className="custom-option">
                    <label>Body Color</label>
                    <div className="color-picker">
                      {['#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899'].map(color => (
                        <button
                          key={color}
                          className={`color-btn ${customization.body_color === color ? 'active' : ''}`}
                          style={{ backgroundColor: color }}
                          onClick={() => updateCustomization({ body_color: color })}
                          data-testid={`color-${color}`}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="lobby-actions">
              <button 
                className="btn btn-primary btn-large" 
                onClick={startMatchmaking}
                data-testid="play-online-btn"
              >
                <span className="btn-icon">⚡</span>
                Play Online
              </button>
              <button className="btn btn-secondary" data-testid="garage-btn">
                <span className="btn-icon">🚗</span>
                Garage
              </button>
              <button className="btn btn-secondary" data-testid="settings-btn">
                <span className="btn-icon">⚙️</span>
                Settings
              </button>
            </div>
          </div>
        </div>
      )}

      {gameState === 'matchmaking' && (
        <div className="matchmaking-screen" data-testid="matchmaking-screen">
          <div className="matchmaking-content">
            <div className="spinner"></div>
            <h2>Finding Match...</h2>
            <p>Searching for opponents</p>
            <div className="progress-bar">
              <div className="progress-fill"></div>
            </div>
          </div>
        </div>
      )}

      {gameState === 'playing' && (
        <>
          <canvas ref={canvasRef} className="game-canvas" data-testid="game-canvas" />
          <div className="game-hud">
            <div className="hud-top">
              <div className="score-display" data-testid="score-display">
                <span className="score-player" data-testid="score-player">{score.player}</span>
                <span className="score-separator">-</span>
                <span className="score-opponent" data-testid="score-opponent">{score.opponent}</span>
              </div>
              <div className="timer-display" data-testid="timer-display">
                {Math.floor(gameTime / 60)}:{(gameTime % 60).toString().padStart(2, '0')}
              </div>
            </div>
            <div className="hud-bottom">
              <div className="boost-bar" data-testid="boost-bar">
                <div className="boost-label">BOOST</div>
                <div className="boost-meter">
                  <div className="boost-fill" style={{ width: `${boost}%` }}></div>
                </div>
                <div className="boost-value">{Math.floor(boost)}%</div>
              </div>
            </div>
            <div className="controls-hint">
              <p>WASD / Arrows - Move | Space - Boost</p>
            </div>
          </div>

          {/* Mobile Controls */}
          <div className="mobile-controls" data-testid="mobile-controls">
            {/* Left Joystick */}
            <div className="joystick-container">
              <div className="joystick-base">
                <div className="joystick-stick"></div>
              </div>
              <div className="joystick-directions">
                <button 
                  className="direction-btn up" 
                  data-testid="mobile-up"
                  onTouchStart={() => { keys['w'] = true; }}
                  onTouchEnd={() => { keys['w'] = false; }}
                >
                  <span>↑</span>
                </button>
                <button 
                  className="direction-btn down" 
                  data-testid="mobile-down"
                  onTouchStart={() => { keys['s'] = true; }}
                  onTouchEnd={() => { keys['s'] = false; }}
                >
                  <span>↓</span>
                </button>
                <button 
                  className="direction-btn left" 
                  data-testid="mobile-left"
                  onTouchStart={() => { keys['a'] = true; }}
                  onTouchEnd={() => { keys['a'] = false; }}
                >
                  <span>←</span>
                </button>
                <button 
                  className="direction-btn right" 
                  data-testid="mobile-right"
                  onTouchStart={() => { keys['d'] = true; }}
                  onTouchEnd={() => { keys['d'] = false; }}
                >
                  <span>→</span>
                </button>
              </div>
            </div>

            {/* Right Action Buttons */}
            <div className="action-buttons">
              <button 
                className="action-btn boost-btn" 
                data-testid="mobile-boost"
                onTouchStart={() => { keys[' '] = true; }}
                onTouchEnd={() => { keys[' '] = false; }}
              >
                <span className="btn-icon">⚡</span>
                <span className="btn-label">BOOST</span>
              </button>
              <button 
                className="action-btn brake-btn" 
                data-testid="mobile-brake"
                onTouchStart={() => { keys['s'] = true; }}
                onTouchEnd={() => { keys['s'] = false; }}
              >
                <span className="btn-icon">🛑</span>
                <span className="btn-label">BRAKE</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default App;