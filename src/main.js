import './style.css';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const canvas = document.getElementById('aion-canvas');
const statusEl = document.getElementById('status');
const logEl = document.getElementById('log');
const inputEl = document.getElementById('message');
const sendBtn = document.getElementById('send');
const voiceBtn = document.getElementById('voice');

const CHAT_URL = 'https://aion-matrix-core.onrender.com/api/chat';

let model = null;
let mixer = null;
let mode = 'idle';
let morphMeshes = [];

function log(message) {
  const text = String(message);
  statusEl.textContent = text;
  logEl.textContent = text + '\n' + logEl.textContent;
  console.log('[AION]', text);
}

function fail(message) {
  const text = 'ERROR: ' + String(message);
  statusEl.textContent = text;
  logEl.textContent = text + '\n' + logEl.textContent;
  console.error('[AION]', text);
}

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020712);

const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 1.25, 3.2);
camera.lookAt(0, 0.4, 0);

scene.add(new THREE.HemisphereLight(0xffffff, 0x203040, 1.2));
const light = new THREE.DirectionalLight(0xffffff, 1.4);
light.position.set(3, 6, 4);
scene.add(light);

const grid = new THREE.GridHelper(5, 12, 0x2b9fff, 0x12324a);
grid.position.y = -1.05;
scene.add(grid);

const testCube = new THREE.Mesh(
  new THREE.BoxGeometry(0.45, 0.45, 0.45),
  new THREE.MeshStandardMaterial({ color: 0x35d9ff })
);
testCube.position.set(0, 0.1, 0);
scene.add(testCube);

function collectMorphs(root) {
  morphMeshes = [];
  root.traverse((node) => {
    if (node.isMesh) node.frustumCulled = false;
    if (node.isMesh && node.morphTargetInfluences && node.morphTargetDictionary) morphMeshes.push(node);
  });
  log('Morph meshes: ' + morphMeshes.length);
}

function fitModel(root) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  root.position.sub(center);
  const max = Math.max(size.x, size.y, size.z);
  const scale = max > 0 ? 2.2 / max : 1;
  root.scale.setScalar(scale);
  root.position.y -= 1.05;
  log('bbox: ' + size.x.toFixed(2) + ' ' + size.y.toFixed(2) + ' ' + size.z.toFixed(2));
}

function resetMorphs() {
  for (const mesh of morphMeshes) {
    for (let i = 0; i < mesh.morphTargetInfluences.length; i++) mesh.morphTargetInfluences[i] = 0;
  }
}

function morph(names, value, timeout = 800) {
  let ok = false;
  for (const mesh of morphMeshes) {
    const dict = mesh.morphTargetDictionary || {};
    for (const key of Object.keys(dict)) {
      const lower = key.toLowerCase();
      if (names.some((n) => lower.includes(n))) {
        mesh.morphTargetInfluences[dict[key]] = value;
        ok = true;
      }
    }
  }
  if (ok) setTimeout(resetMorphs, timeout);
  return ok;
}

async function loadAion() {
  log('Loading /models/AION_TEST.glb');
  const loader = new GLTFLoader();
  loader.load(
    '/models/AION_TEST.glb',
    (gltf) => {
      model = gltf.scene || gltf.scenes[0];
      if (!model) return fail('GLB loaded but scene is empty');
      scene.remove(testCube);
      fitModel(model);
      collectMorphs(model);
      scene.add(model);
      if (gltf.animations && gltf.animations.length > 0) {
        mixer = new THREE.AnimationMixer(model);
        mixer.clipAction(gltf.animations[0]).play();
        log('MODEL_READY animations: ' + gltf.animations.length);
      } else {
        log('MODEL_READY no animation clips; procedural idle active');
      }
    },
    (event) => {
      if (event.total) log('Loading model ' + Math.round((event.loaded / event.total) * 100) + '%');
    },
    (error) => fail('GLB load error: ' + (error?.message || String(error)))
  );
}

function setMode(next) {
  mode = next;
  resetMorphs();
  if (next === 'happy') morph(['joy', 'fun', 'happy', 'smile'], 1, 1200);
  if (next === 'talk') morph(['a', 'aa', 'mouth', 'viseme'], 0.9, 650);
  if (next === 'dance') log('Dance animation missing in test model');
  else log('Mode: ' + next);
}

document.querySelectorAll('[data-mode]').forEach((btn) => {
  btn.addEventListener('click', () => setMode(btn.dataset.mode));
});

async function sendMessage() {
  const text = inputEl.value.trim();
  if (!text) return;
  inputEl.value = '';
  log('You: ' + text);
  setMode('think');
  try {
    const response = await fetch(CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, auth_provider: 'web', auth_identifier: 'aion-web3d' })
    });
    const raw = await response.text();
    if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + raw);
    const json = JSON.parse(raw);
    const answer = json.answer || json.message || '';
    if (!answer) throw new Error('empty backend answer: ' + raw);
    log('AION: ' + answer);
    setMode('talk');
    speak(answer);
  } catch (error) {
    fail('Backend error: ' + (error?.message || String(error)));
    setMode('idle');
  }
}

function speak(text) {
  if (!('speechSynthesis' in window)) return log('Speech synthesis unavailable');
  const u = new SpeechSynthesisUtterance(String(text).slice(0, 450));
  u.lang = 'ru-RU';
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

function startVoice() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return fail('Speech recognition unavailable in this browser');
  const rec = new SpeechRecognition();
  rec.lang = 'ru-RU';
  rec.onresult = (e) => {
    inputEl.value = e.results[0][0].transcript;
    sendMessage();
  };
  rec.onerror = (e) => fail('Voice error: ' + e.error);
  rec.start();
}

sendBtn.addEventListener('click', sendMessage);
voiceBtn.addEventListener('click', startVoice);
inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  const t = performance.now() / 1000;
  if (mixer) mixer.update(dt);
  if (model) {
    if (mode === 'idle') model.rotation.y += dt * 0.18;
    if (mode === 'think') model.rotation.y = Math.sin(t * 1.2) * 0.18;
    if (mode === 'talk') model.rotation.y = Math.sin(t * 2.6) * 0.06;
    if (mode === 'happy') model.rotation.y = Math.sin(t * 3.0) * 0.09;
  } else {
    testCube.rotation.x += dt * 0.7;
    testCube.rotation.y += dt * 1.1;
  }
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

loadAion();
animate();
