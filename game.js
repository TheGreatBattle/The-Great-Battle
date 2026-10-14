import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, onValue, onDisconnect, push, remove } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

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
let scene, camera, renderer, hangarPlaneModel, grassTerrainPlane;
let localFlightPhysicsVehicleObject;
let cachedPlaneModel = null;
const onlineNetVisualPlanesMap = {};
const aiBotPlanesArray = [];
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
        // War Thunder Blue Sky Atmosphere
        scene.background = new THREE.Color(0x6ba4e8);
        scene.fog = new THREE.FogExp2(0x8cb8e8, 0.0008);

        camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 5000);
        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.shadowMap.enabled = true;
        container.appendChild(renderer.domElement);

        const ambient = new THREE.AmbientLight(0xffffff, 0.7);
        scene.add(ambient);
        const sunLight = new THREE.DirectionalLight(0xfffaed, 1.1);
        sunLight.position.set(200, 400, 200);
        scene.add(sunLight);

        // Grass Terrain Plane
        const terrainGeo = new THREE.PlaneGeometry(8000, 8000);
        const terrainMat = new THREE.MeshLambertMaterial({ color: 0x3d6b38 });
        grassTerrainPlane = new THREE.Mesh(terrainGeo, terrainMat);
        grassTerrainPlane.rotation.x = -Math.PI / 2;
        grassTerrainPlane.position.y = -50;
        scene.add(grassTerrainPlane);

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
            new THREE.BoxGeometry(1.2, 0.8, 3.5),
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
        div.innerHTML = `<div class="crew-lvl">CREW LEVEL 24</div><div class="crew-plane">${plane.name}</div><div style="font-size:11px; color:#58a6ff; font-weight:bold;">BR ${plane.br}</div>`;
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
        node.innerHTML = `<div style="font-weight:bold; font-size:14px; color:#fff;">${plane.name}</div><div style="font-size:11px; color:#8b949e;">BR: ${plane.br}</div><div class="node-cost" style="margin-top:6px; font-size:12px;">${plane.unlocked ? '<span style="color:#3fb950; font-weight:bold;">RESEARCHED</span>' : `Research: 🦁 ${plane.cost.toLocaleString()} SL`}</div>`;
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
        alert("Crew performance parameters upgraded successfully.");
    } else {
        alert("Insufficient Silver Lions allocation.");
    }
};

function handleKeyToggle(e, isDown) {
    const key = e.key.toLowerCase();
    if (key === 'w' || e.key === 'arrowup') playerControlInputVectors.w = isDown;
    if (key === 's' || e.key === 'arrowdown') playerControlInputVectors.s = isDown;
    if (key === 'a' || e.key === 'arrowleft') playerControlInputVectors.a = isDown;
    if (key === 'd' || e.key === 'arrowright') playerControlInputVectors.d = isDown;
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
    localFlightPhysicsVehicleObject.position.set(0, 180, 0);
    scene.add(localFlightPhysicsVehicleObject);

    currentVehicleHP = 100;
    document.getElementById('hud-hp').innerText = "100%";
    document.getElementById('hud-hp').style.color = "#3fb950";

    // Spawn AI Enemy & Allied Bots for Arcade Dogfighting
    spawnAiSquadron();
    setupMultiplayerNetworkStream();
};

function spawnAiSquadron() {
    // Clear old bots
    aiBotPlanesArray.forEach(bot => scene.remove(bot.mesh));
    aiBotPlanesArray.length = 0;

    for (let i = 0; i < 3; i++) {
        const botMesh = assemblePixelatedAeroMesh(0xbb3333);
        botMesh.position.set(
            (Math.random() - 0.5) * 600,
            150 + Math.random() * 100,
            -300 - Math.random() * 300
        );
        scene.add(botMesh);
        aiBotPlanesArray.push({
            mesh: botMesh,
            speed: 0.38,
            angle: Math.random() * Math.PI * 2,
            hp: 60
        });
        pushCombatLogEntry(`⚠️ Enemy AI Fighter [Bf 109 - ${i+1}] detected in sector!`);
    }
}

window.exitToHangar = function() {
    gameStateMode = "hangar";
    document.getElementById('ui-layer').style.display = 'flex';
    document.getElementById('flight-hud').style.display = 'none';
    
    if (localFlightPhysicsVehicleObject) {
        scene.remove(localFlightPhysicsVehicleObject);
        localFlightPhysicsVehicleObject = null;
    }
    aiBotPlanesArray.forEach(bot => scene.remove(bot.mesh));
    aiBotPlanesArray.length = 0;

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
                onlineNetVisualPlanesMap[id] = assemblePixelatedAeroMesh(0x388bfd);
                scene.add(onlineNetVisualPlanesMap[id]);
                pushCombatLogEntry(`🌐 Allied Pilot [${id}] joined session.`);
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
    const forwardVector = new THREE.Vector3(0, 0, -1);
    forwardVector.applyQuaternion(localFlightPhysicsVehicleObject.quaternion);
    const muzzlePos = localFlightPhysicsVehicleObject.position.clone().add(forwardVector.clone().multiplyScalar(2.5));
    
    spawnTracerProjectile(muzzlePos, forwardVector, sessionId);
    push(projectilestreamRef, {
        owner: sessionId,
        pos: { x: muzzlePos.x, y: muzzlePos.y, z: muzzlePos.z },
        dir: { x: forwardVector.x, y: forwardVector.y, z: forwardVector.z },
        timestamp: Date.now()
    });
}

function spawnTracerProjectile(originPos, vectorDir, ownerId) {
    const tracerGeo = new THREE.CylinderGeometry(0.04, 0.04, 1.2, 6);
    tracerGeo.rotateX(Math.PI / 2);
    const tracerMat = new THREE.MeshBasicMaterial({ color: ownerId === sessionId ? 0xffea00 : 0xff4747 });
    const bulletMesh = new THREE.Mesh(tracerGeo, tracerMat);
    bulletMesh.position.copy(originPos);
    bulletMesh.lookAt(originPos.clone().add(vectorDir));
    scene.add(bulletMesh);
    
    localActiveProjectilesArray.push({
        mesh: bulletMesh,
        dir: vectorDir,
        owner: ownerId,
        age: 0,
        maxAge: 140
    });
}

function processLocalDamageEvent(attackerId) {
    currentVehicleHP -= 20;
    set(ref(database, `matchmaking/arena/${sessionId}/hitRegistered`), { active: false, by: "" });
    const hpUI = document.getElementById('hud-hp');
    hpUI.innerText = `${currentVehicleHP}%`;
    if (currentVehicleHP <= 50) hpUI.style.color = "#f0883e";
    if (currentVehicleHP <= 20) hpUI.style.color = "#ff7b72";
    pushCombatLogEntry(`💥 Critical hit taken from [${attackerId}]!`);
    if (currentVehicleHP <= 0) {
        pushCombatLogEntry(`💀 Aircraft destroyed in combat!`);
        alert(`Your aircraft was shot down! Returning to hangar.`);
        exitToHangar();
    }
}

function pushCombatLogEntry(messageString) {
    const feed = document.getElementById('combat-feed');
    const item = document.createElement('div');
    item.innerText = messageString;
    feed.appendChild(item);
    if (feed.childNodes.length > 6) feed.removeChild(feed.firstChild);
}

let weaponCooldown = 0;
function animateEngineFrame() {
    requestAnimationFrame(animateEngineFrame);
    if (gameStateMode === "hangar") {
        if (hangarPlaneModel) hangarPlaneModel.rotation.y += 0.005;
    } else if (gameStateMode === "combat" && localFlightPhysicsVehicleObject) {
        const flightSpeed = 0.52;
        localFlightPhysicsVehicleObject.translateZ(-flightSpeed);
        
        // War Thunder Arcade Arcade-style responsive steering controls
        const turnSensitivity = 0.028;
        if (playerControlInputVectors.w) localFlightPhysicsVehicleObject.rotation.x -= turnSensitivity;
        if (playerControlInputVectors.s) localFlightPhysicsVehicleObject.rotation.x += turnSensitivity;
        if (playerControlInputVectors.a) {
            localFlightPhysicsVehicleObject.rotation.y += turnSensitivity;
            localFlightPhysicsVehicleObject.rotation.z += turnSensitivity * 0.8;
        } else if (playerControlInputVectors.d) {
            localFlightPhysicsVehicleObject.rotation.y -= turnSensitivity;
            localFlightPhysicsVehicleObject.rotation.z -= turnSensitivity * 0.8;
        } else {
            localFlightPhysicsVehicleObject.rotation.z *= 0.92; // Stabilize roll
        }
        
        // Terrain Collision Check
        if (localFlightPhysicsVehicleObject.position.y < -48) {
            localFlightPhysicsVehicleObject.position.y = -48;
            currentVehicleHP -= 5;
            if (currentVehicleHP <= 0) {
                pushCombatLogEntry("💥 Crashed into terrain!");
                exitToHangar();
                return;
            }
        }

        // Update AI Bot Movement
        aiBotPlanesArray.forEach((bot, index) => {
            bot.angle += 0.01;
            bot.mesh.position.x += Math.sin(bot.angle) * 1.5;
            bot.mesh.position.z += Math.cos(bot.angle) * 1.5;
            bot.mesh.rotation.y = bot.angle;

            // Check collision with player bullets or proximity
            const dist = localFlightPhysicsVehicleObject.position.distanceTo(bot.mesh.position);
            if (dist < 350 && Math.random() < 0.01) {
                pushCombatLogEntry(`🎯 Enemy [Bf 109 #${index+1}] firing at your six!`);
            }
        });

        // Chase Camera Rig
        const cameraOffset = new THREE.Vector3(0, 1.2, 4.2);
        const targetCamPos = cameraOffset.applyMatrix4(localFlightPhysicsVehicleObject.matrixWorld);
        camera.position.lerp(targetCamPos, 0.3);
        camera.lookAt(localFlightPhysicsVehicleObject.position.clone().add(new THREE.Vector3(0, 0.3, 0)));

        if (weaponCooldown > 0) weaponCooldown--;
        if (playerControlInputVectors.space && weaponCooldown === 0) {
            triggerWeaponDischarge();
            weaponCooldown = 5;
        }

        // Projectile Updates & Hit Detection
        for (let i = localActiveProjectilesArray.length - 1; i >= 0; i--) {
            const bullet = localActiveProjectilesArray[i];
            bullet.mesh.position.add(bullet.dir.clone().multiplyScalar(2.8));
            bullet.age++;

            if (bullet.owner === sessionId) {
                // Check hits against AI bots
                aiBotPlanesArray.forEach((bot, idx) => {
                    if (bullet.mesh.position.distanceTo(bot.mesh.position) < 3.5) {
                        bullet.age = bullet.maxAge;
                        bot.hp -= 25;
                        pushCombatLogEntry(`💥 Hit scored on Enemy AI #${idx+1} (${bot.hp}% HP)`);
                        if (bot.hp <= 0) {
                            scene.remove(bot.mesh);
                            aiBotPlanesArray.splice(idx, 1);
                            pushCombatLogEntry(`🏆 Enemy AI Aircraft Shot Down!`);
                        }
                    }
                });

                // Check hits against online remote players
                Object.keys(onlineNetVisualPlanesMap).forEach(remotePlayerId => {
                    const enemyPlane = onlineNetVisualPlanesMap[remotePlayerId];
                    if (bullet.mesh.position.distanceTo(enemyPlane.position) < 3.0) {
                        bullet.age = bullet.maxAge;
                        pushCombatLogEntry(`🎯 Hit registered against player [${remotePlayerId}]!`);
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

        document.getElementById('hud-spd').innerText = Math.round(flightSpeed * 1250);
        document.getElementById('hud-alt').innerText = Math.round(localFlightPhysicsVehicleObject.position.y + 50);
    }
    renderer.render(scene, camera);
}

window.addEventListener('DOMContentLoaded', initializeAppCore);
