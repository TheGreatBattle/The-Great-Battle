import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, onValue, onDisconnect, push, remove } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import * as THREE from "https://unpkg.com/three@0.128.0/build/three.module.js";
import { GLTFLoader } from "https://unpkg.com/three@0.128.0/examples/jsm/loaders/GLTFLoader.js";

const firebaseConfig = {
    apiKey: "AIzaSyBSo3GMBnLzfV5svZRBU8nAWq837TZH0ic",
    authDomain: "firebaseapp.com",
    projectId: "the-great-battle-d675b",
    storageBucket: "the-great-battle-d675b.firebasestorage.app",
    messagingSenderId: "272825915387",
    appId: "1:272825915387:web:9d59e388e050f57fa99d5e",
    databaseURL: "https://the-great-battle-d675b-default-rtdb.firebaseio.com"
};

const app = initializeApp(firebaseConfig);
const database = getDatabase(app);
const sessionId = "Pilot_" + Math.floor(Math.random() * 9000 + 1000);
const playerNetworkRef = ref(database, 'matchmaking/arena/' + sessionId);
const globalMatchRef = ref(database, 'matchmaking/arena');
const projectilestreamRef = ref(database, 'matchmaking/projectiles');
onDisconnect(playerNetworkRef).remove();

const AIRCRAFT_REGISTRY = [
    { id: "p51", name: "P-51D Mustang", nation: "USA", br: 4.3, speed: 703, turn: 21.5, climb: 14.8, cost: 0, color: 0x7a8b99, unlocked: true, desc: "High velocity escort fighter with heavy dive contours." },
    { id: "f4u", name: "F4U-1D Corsair", nation: "USA", br: 3.7, speed: 671, turn: 22.0, climb: 13.2, cost: 12000, color: 0x1c2d42, unlocked: false, desc: "Carrier fighter sporting unique inverted gull wings." },
    { id: "bf109", name: "Bf 109 G-6", nation: "GER", br: 4.7, speed: 640, turn: 20.0, climb: 19.5, cost: 0, color: 0x545c52, unlocked: true, desc: "Interception master with devastating nose cannon configuration." },
    { id: "fw190", name: "Fw 190 A-5", nation: "GER", br: 5.0, speed: 660, turn: 23.5, climb: 15.0, cost: 18000, color: 0x3d3f3c, unlocked: false, desc: "Heavy firepower platform providing excellent roll stability." },
    { id: "yak3", name: "Yak-3 Fighter", nation: "USSR", br: 4.3, speed: 655, turn: 18.5, climb: 18.0, cost: 0, color: 0x6e786c, unlocked: true, desc: "Light frame configuration optimized for agile dogfights." },
    { id: "spitfire", name: "Spitfire Mk IX", nation: "UK", br: 4.3, speed: 595, turn: 16.0, climb: 16.5, cost: 0, color: 0x4d5946, unlocked: true, desc: "Elliptical wing design giving tighter horizontal turn rates." }
];

let economy = { sl: 75000, ge: 490 };
let activeSelectedAircraft = AIRCRAFT_REGISTRY[0];
let activeNationFilter = "USA";
let gameStateMode = "hangar";
let scene, camera, renderer, hangarPlaneModel, simulationFloorGrid;
let localFlightPhysicsVehicleObject;
let cachedPlaneModel = null;
const onlineNetVisualPlanesMap = {};
const localActiveProjectilesArray = [];
const playerControlInputVectors = { w: false, s: false, a: false, d: false, space: false };
let currentVehicleHP = 100;

function initializeAppCore() {
    const container = document.getElementById("canvas-container");
    const gltfLoader = new GLTFLoader();
    gltfLoader.load("my_plane.glb", (gltf) => {
        cachedPlaneModel = gltf.scene;
        continueInitialization();
    }, undefined, (error) => {
        console.warn("GLTF load skipped, using box fallback", error);
        continueInitialization();
    });

    function continueInitialization() {
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0e1318);
        camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 2000);
        renderer = new THREE.WebGLRenderer({ antialias: false });
        renderer.setSize(window.innerWidth, window.innerHeight);
        container.appendChild(renderer.domElement);

        const ambient = new THREE.AmbientLight(0xffffff, 0.6);
        scene.add(ambient);
        const sunLight = new THREE.DirectionalLight(0xffffff, 0.8);
        sunLight.position.set(40, 100, 40);
        scene.add(sunLight);

        simulationFloorGrid = new THREE.GridHelper(2000, 80, 0x3c4852, 0x171f26);
        simulationFloorGrid.position.y = -50;
        scene.add(simulationFloorGrid);

        updateHangarShowcaseModel();
        window.addEventListener('keydown', (e) => handleKeyToggle(e, true));
        window.addEventListener('keyup', (e) => handleKeyToggle(e, false));
        window.addEventListener('resize', onWindowResizeHandler);
        renderActiveFleetSlots();
        renderResearchTreeMatrix();
        updateUIFields();
        animateEngineFrame();
    }
}

function assemblePixelatedAeroMesh(colorHex) {
    const airplaneCompositeGroup = new THREE.Group();
    if (cachedPlaneModel) {
        const modelClone = cachedPlaneModel.clone();
        airplaneCompositeGroup.add(modelClone);
    } else {
        const fallbackBox = new THREE.Mesh(
            new THREE.BoxGeometry(1, 1, 3),
            new THREE.MeshLambertMaterial({ color: colorHex })
        );
        airplaneCompositeGroup.add(fallbackBox);
    }
    return airplaneCompositeGroup;
}

function updateHangarShowcaseModel() {
    if (hangarPlaneModel) scene.remove(hangarPlaneModel);
    if (gameStateMode !== "hangar") return;
    hangarPlaneModel = assemblePixelatedAeroMesh(activeSelectedAircraft.color);
    scene.add(hangarPlaneModel);
    camera.position.set(3.5, 2.0, 5.0);
    camera.lookAt(0, 0, 0);
}

window.switchHangarTab = function(tabName) {
    document.querySelectorAll('.center-display').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    const targetedTab = document.getElementById('tab-' + tabName);
    if (targetedTab) targetedTab.classList.add('active');
    const targetBtn = document.getElementById('btn-tab-' + tabName);
    if (targetBtn) targetBtn.classList.add('active');
};

window.filterTreeNation = function(nationCode) {
    activeNationFilter = nationCode;
    document.querySelectorAll('.nation-tab').forEach(btn => btn.classList.remove('active'));
    const activeNBtn = document.getElementById('ntab-' + nationCode);
    if(activeNBtn) activeNBtn.classList.add('active');
    renderResearchTreeMatrix();
};

function renderActiveFleetSlots() {
    const target = document.getElementById('fleet-carousel-slots');
    target.innerHTML = '';
    const displayFleet = AIRCRAFT_REGISTRY.filter(p => p.unlocked);
    displayFleet.forEach(plane => {
        const isSelected = plane.id === activeSelectedAircraft.id;
        const div = document.createElement('div');
        div.className = `crew-slot ${isSelected ? 'active' : ''}`;
        div.onclick = () => {
            activeSelectedAircraft = plane;
            updateUIFields();
            updateHangarShowcaseModel();
            renderActiveFleetSlots();
        };
        div.innerHTML = `<div class="crew-lvl">CREW LEVEL 24</div><div class="crew-plane">${plane.name}</div><div style="font-size:11px; color:#4ba3e3; font-weight:bold;">BR ${plane.br}</div>`;
        target.appendChild(div);
    });
}

function renderResearchTreeMatrix() {
    const grid = document.getElementById('tree-grid-target');
    grid.innerHTML = '';
    const targetedNationSet = AIRCRAFT_REGISTRY.filter(p => p.nation === activeNationFilter);
    targetedNationSet.forEach(plane => {
        const node = document.createElement('div');
        node.className = `research-node ${plane.unlocked ? 'unlocked' : 'locked'}`;
        node.onclick = () => {
            if (!plane.unlocked && economy.sl >= plane.cost) {
                economy.sl -= plane.cost;
                plane.unlocked = true;
                updateUIFields();
                renderResearchTreeMatrix();
                renderActiveFleetSlots();
                alert(`Successfully researched ${plane.name}!`);
            }
        };
        node.innerHTML = `<div style="font-weight:bold; font-size:14px; color:#fff;">${plane.name}</div><div style="font-size:11px; color:#8a9ba8;">BR: ${plane.br}</div><div class="node-cost">${plane.unlocked ? '<span style="color:#42a136;">RESEARCHED</span>' : `Research: 🦁 ${plane.cost.toLocaleString()} SL`}</div>`;
        grid.appendChild(node);
    });
}

function updateUIFields() {
    document.getElementById('sl-val').innerText = economy.sl.toLocaleString();
    document.getElementById('ge-val').innerText = economy.ge.toLocaleString();
    document.getElementById('card-name').innerText = activeSelectedAircraft.name;
    document.getElementById('card-nation').innerText = `${activeSelectedAircraft.nation} - Tier III`;
    document.getElementById('card-br').innerText = activeSelectedAircraft.br.toFixed(1);
    document.getElementById('card-maxspd').innerText = `${activeSelectedAircraft.speed} km/h`;
    document.getElementById('card-turn').innerText = `${activeSelectedAircraft.turn.toFixed(1)} s`;
    document.getElementById('card-climb').innerText = `${activeSelectedAircraft.climb.toFixed(1)} m/s`;
    document.getElementById('card-desc').innerText = activeSelectedAircraft.desc;
}

window.buyCrewUpgrade = function() {
    if (economy.sl >= 5000) {
        economy.sl -= 5000;
        updateUIFields();
        alert("Crew metrics expanded successfully.");
    } else {
        alert("Insufficient Silver Lions allocation.");
    }
};

function handleKeyToggle(e, isDown) {
    const key = e.key.toLowerCase();
    if (key === 'w' || e.key === 'ArrowUp') playerControlInputVectors.w = isDown;
    if (key === 's' || e.key === 'ArrowDown') playerControlInputVectors.s = isDown;
    if (key === 'a' || e.key === 'ArrowLeft') playerControlInputVectors.a = isDown;
    if (key === 'd' || e.key === 'ArrowRight') playerControlInputVectors.d = isDown;
    if (e.code === 'Space') playerControlInputVectors.space = isDown;
    if (e.key === 'Escape' && gameStateMode === "combat") exitToHangar();
}

function onWindowResizeHandler() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

window.launchToBattle = function() {
    gameStateMode = "combat";
    document.getElementById('ui-layer').style.display = 'none';
    document.getElementById('flight-hud').style.display = 'flex';
    if (hangarPlaneModel) scene.remove(hangarPlaneModel);
    localFlightPhysicsVehicleObject = assemblePixelatedAeroMesh(activeSelectedAircraft.color);
    localFlightPhysicsVehicleObject.position.set(
        Math.random() * 200 - 100,
        150 + Math.random() * 50,
        Math.random() * 200 - 100
    );
    scene.add(localFlightPhysicsVehicleObject);
    currentVehicleHP = 100;
    document.getElementById('hud-hp').innerText = "100%";
    document.getElementById('hud-hp').style.color = "#53ff53";
    setupMultiplayerNetworkStream();
};

window.exitToHangar = function() {
    gameStateMode = "hangar";
    document.getElementById('ui-layer').style.display = 'flex';
    document.getElementById('flight-hud').style.display = 'none';
    if (localFlightPhysicsVehicleObject) {
        scene.remove(localFlightPhysicsVehicleObject);
        localFlightPhysicsVehicleObject = null;
    }
    Object.keys(onlineNetVisualPlanesMap).forEach(id => {
        scene.remove(onlineNetVisualPlanesMap[id]);
        delete onlineNetVisualPlanesMap[id];
    });
    remove(playerNetworkRef);
    updateHangarShowcaseModel();
};

function setupMultiplayerNetworkStream() {
    onValue(globalMatchRef, (snapshot) => {
        if (gameStateMode !== "combat") return;
        const data = snapshot.val() || {};
        Object.keys(onlineNetVisualPlanesMap).forEach(id => {
            if (!data[id]) {
                scene.remove(onlineNetVisualPlanesMap[id]);
                delete onlineNetVisualPlanesMap[id];
            }
        });
        Object.keys(data).forEach(id => {
            if (id === sessionId) {
                if (data[id].hitRegistered && data[id].hitRegistered.active) {
                    processLocalDamageEvent(data[id].hitRegistered.by);
                }
                return;
            }
            const networkEntityInfo = data[id];
            if (!onlineNetVisualPlanesMap[id]) {
                onlineNetVisualPlanesMap[id] = assemblePixelatedAeroMesh(0xbf3b3b);
                scene.add(onlineNetVisualPlanesMap[id]);
                pushCombatLogEntry(`⚠️ Enemy pilot [${id}] spawned!`);
            }
            if (networkEntityInfo.position && networkEntityInfo.rotation) {
                onlineNetVisualPlanesMap[id].position.set(networkEntityInfo.position.x, networkEntityInfo.position.y, networkEntityInfo.position.z);
                onlineNetVisualPlanesMap[id].rotation.set(networkEntityInfo.rotation.x, networkEntityInfo.rotation.y, networkEntityInfo.rotation.z);
            }
        });
    });

    onValue(projectilestreamRef, (snapshot) => {
        if (gameStateMode !== "combat") return;
        const data = snapshot.val();
        if (!data) return;
        Object.keys(data).forEach(bulletId => {
            const b = data[bulletId];
            if (b.owner !== sessionId && !b.processedLocal) {
                spawnTracerProjectile(
                    new THREE.Vector3(b.pos.x, b.pos.y, b.pos.z),
                    new THREE.Vector3(b.dir.x, b.dir.y, b.dir.z),
                    b.owner
                );
                b.processedLocal = true;
            }
        });
    });
}

function triggerWeaponDischarge() {
    if (!localFlightPhysicsVehicleObject) return;
    const projectileForwardVectorMat = new THREE.Vector3(0, 0, -1);
    projectileForwardVectorMat.applyQuaternion(localFlightPhysicsVehicleObject.quaternion);
    const muzzleLocationVector = localFlightPhysicsVehicleObject.position.clone().add(projectileForwardVectorMat.clone().multiplyScalar(2.0));
    spawnTracerProjectile(muzzleLocationVector, projectileForwardVectorMat, sessionId);
    push(projectilestreamRef, {
        owner: sessionId,
        pos: { x: muzzleLocationVector.x, y: muzzleLocationVector.y, z: muzzleLocationVector.z },
        dir: { x: projectileForwardVectorMat.x, y: projectileForwardVectorMat.y, z: projectileForwardVectorMat.z },
        timestamp: Date.now()
    });
}

function spawnTracerProjectile(originPos, vectorDir, ownerId) {
    const tracerBoxGeo = new THREE.BoxGeometry(0.08, 0.08, 0.6);
    const tracerMat = new THREE.MeshBasicMaterial({ color: ownerId === sessionId ? 0x53ff53 : 0xffaa00 });
    const bulletMeshInstance = new THREE.Mesh(tracerBoxGeo, tracerMat);
    bulletMeshInstance.position.copy(originPos);
    bulletMeshInstance.lookAt(originPos.clone().add(vectorDir));
    scene.add(bulletMeshInstance);
    localActiveProjectilesArray.push({ mesh: bulletMeshInstance, dir: vectorDir, owner: ownerId, age: 0, maxAge: 120 });
}

function processLocalDamageEvent(attackerId) {
    currentVehicleHP -= 15;
    set(ref(database, `matchmaking/arena/${sessionId}/hitRegistered`), { active: false, by: "" });
    const hpUIElement = document.getElementById('hud-hp');
    hpUIElement.innerText = `${currentVehicleHP}%`;
    if (currentVehicleHP <= 50) hpUIElement.style.color = "#ffaa00";
    if (currentVehicleHP <= 20) hpUIElement.style.color = "#ff3b3b";
    pushCombatLogEntry(`💥 Impact taken! Hit from [${attackerId}]`);
    if (currentVehicleHP <= 0) {
        pushCombatLogEntry(`💀 Shot down by [${attackerId}]`);
        alert(`Your aircraft was shot down by pilot: ${attackerId}`);
        exitToHangar();
    }
}

function pushCombatLogEntry(messageString) {
    const feed = document.getElementById('combat-feed');
    const item = document.createElement('div');
    item.innerText = messageString;
    feed.appendChild(item);
    if (feed.childNodes.length > 5) feed.removeChild(feed.firstChild);
}

let internalWeaponFiringRateCooldownCounter = 0;
function animateEngineFrame() {
    requestAnimationFrame(animateEngineFrame);
    if (gameStateMode === "hangar") {
        if (hangarPlaneModel) hangarPlaneModel.rotation.y += 0.004;
    } else if (gameStateMode === "combat" && localFlightPhysicsVehicleObject) {
        const baseVelocityVectorMag = 0.45;
        localFlightPhysicsVehicleObject.translateZ(-baseVelocityVectorMag);
        const rotationDeltaFactor = 0.024;
        if (playerControlInputVectors.w) localFlightPhysicsVehicleObject.rotation.x -= rotationDeltaFactor;
        if (playerControlInputVectors.s) localFlightPhysicsVehicleObject.rotation.x += rotationDeltaFactor;
        if (playerControlInputVectors.a) localFlightPhysicsVehicleObject.rotation.y += rotationDeltaFactor;
        if (playerControlInputVectors.d) localFlightPhysicsVehicleObject.rotation.y -= rotationDeltaFactor;
        
        if (localFlightPhysicsVehicleObject.position.y < -48) {
            localFlightPhysicsVehicleObject.position.y = -48;
            currentVehicleHP -= 2;
            if (currentVehicleHP <= 0) {
                pushCombatLogEntry("💀 Terrain collision impact!");
                exitToHangar();
                return;
            }
        }
        
        const spatialOffsetTargetVector = new THREE.Vector3(0, 0.8, 3.8);
        const computedRigCameraWorldCoordinates = spatialOffsetTargetVector.applyMatrix4(localFlightPhysicsVehicleObject.matrixWorld);
        camera.position.lerp(computedRigCameraWorldCoordinates, 0.25);
        camera.lookAt(localFlightPhysicsVehicleObject.position.clone().add(new THREE.Vector3(0, 0.2, 0)));
        
        if (internalWeaponFiringRateCooldownCounter > 0) internalWeaponFiringRateCooldownCounter--;
        if (playerControlInputVectors.space && internalWeaponFiringRateCooldownCounter === 0) {
            triggerWeaponDischarge();
            internalWeaponFiringRateCooldownCounter = 6;
        }
        
        for (let i = localActiveProjectilesArray.length - 1; i >= 0; i--) {
            const bullet = localActiveProjectilesArray[i];
            const speedMultiplierMatrixFactor = 2.2;
            bullet.mesh.position.add(bullet.dir.clone().multiplyScalar(speedMultiplierMatrixFactor));
            bullet.age++;
            if (bullet.owner === sessionId) {
                Object.keys(onlineNetVisualPlanesMap).forEach(remotePlayerId => {
                    const enemyPlane = onlineNetVisualPlanesMap[remotePlayerId];
                    const physicalProximityDistance = bullet.mesh.position.distanceTo(enemyPlane.position);
                    if (physicalProximityDistance < 2.0) {
                        bullet.age = bullet.maxAge;
                        pushCombatLogEntry(`🎯 Hit registered against [${remotePlayerId}]!`);
                        set(ref(database, `matchmaking/arena/${remotePlayerId}/hitRegistered`), {
                            active: true,
                            by: sessionId,
                            timeNonce: Date.now()
                        });
                    }
                });
            }
            if (bullet.age >= bullet.maxAge) {
                scene.remove(bullet.mesh);
                localActiveProjectilesArray.splice(i, 1);
            }
        }
        
        set(playerNetworkRef, {
            position: { x: localFlightPhysicsVehicleObject.position.x, y: localFlightPhysicsVehicleObject.position.y, z: localFlightPhysicsVehicleObject.position.z },
            rotation: { x: localFlightPhysicsVehicleObject.rotation.x, y: localFlightPhysicsVehicleObject.rotation.y, z: localFlightPhysicsVehicleObject.rotation.z },
            heartbeat: Date.now()
        });
        
        document.getElementById('hud-spd').innerText = Math.round(baseVelocityVectorMag * 1200);
        document.getElementById('hud-alt').innerText = Math.round(localFlightPhysicsVehicleObject.position.y + 50);
    }
    renderer.render(scene, camera);
}

window.addEventListener('DOMContentLoaded', initializeAppCore);
