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
const MODEL_URL = '/models/AION_TEST.glb';

/*
  Если модель снова стоит спиной:
  1) попробуй Math.PI
  2) если не поможет — поставь 0
  3) если боком — попробуй Math.PI / 2 или -Math.PI / 2
*/
const MODEL_FRONT_ROTATION = Math.PI;

let model = null;
let mixer = null;
let mode = 'idle';
let morphMeshes = [];
let speechUnlocked = false;

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

function unlockSpeech() {
  if (speechUnlocked) return;
  if (!('speechSynthesis' in window)) return;

  try {
    const utterance = new SpeechSynthesisUtterance('');
    utterance.lang = 'ru-RU';
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    speechUnlocked = true;
    log('TTS unlocked by user action');
  } catch (error) {
    log('TTS unlock failed: ' + (error?.message || String(error)));
  }
}

document.addEventListener(
  'click',
  () => {
    unlockSpeech();
  },
  { once: true }
);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false
});

renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

if ('outputColorSpace' in renderer) {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020712);

const camera = new THREE.PerspectiveCamera(
  35,
  window.innerWidth / window.innerHeight,
  0.1,
  100
);

camera.position.set(0, 1.3, 3.4);
camera.lookAt(0, 0.55, 0);

const hemiLight = new THREE.HemisphereLight(0xffffff, 0x203040, 1.25);
scene.add(hemiLight);

const keyLight = new THREE.DirectionalLight(0xffffff, 1.45);
keyLight.position.set(3, 6, 4);
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0x6fd7ff, 0.85);
rimLight.position.set(-4, 3, -2);
scene.add(rimLight);

const grid = new THREE.GridHelper(5, 12, 0x2b9fff, 0x12324a);
grid.position.y = 0;
scene.add(grid);

const testCube = new THREE.Mesh(
  new THREE.BoxGeometry(0.45, 0.45, 0.45),
  new THREE.MeshStandardMaterial({
    color: 0x35d9ff,
    emissive: 0x062033,
    roughness: 0.45,
    metalness: 0.15
  })
);

testCube.position.set(0, 1, 0);
scene.add(testCube);

function collectMorphs(root) {
  morphMeshes = [];

  root.traverse((node) => {
    if (node.isMesh) {
      node.frustumCulled = false;
    }

    if (
      node.isMesh &&
      node.morphTargetInfluences &&
      node.morphTargetDictionary
    ) {
      morphMeshes.push(node);
    }
  });

  log('Morph meshes: ' + morphMeshes.length);
}

function fitModel(root) {
  root.rotation.y = MODEL_FRONT_ROTATION;

  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= box.min.y;

  const maxSize = Math.max(size.x, size.y, size.z);
  const scale = maxSize > 0 ? 2.15 / maxSize : 1;

  root.scale.setScalar(scale);

  const finalBox = new THREE.Box3().setFromObject(root);
  const finalSize = finalBox.getSize(new THREE.Vector3());
  const finalCenter = finalBox.getCenter(new THREE.Vector3());

  root.position.x -= finalCenter.x;
  root.position.z -= finalCenter.z;
  root.position.y -= finalBox.min.y;

  camera.position.set(0, finalSize.y * 0.75, finalSize.z * 2.35 + 1.4);
  camera.lookAt(0, finalSize.y * 0.48, 0);

  grid.position.y = 0;

  log(
    'MODEL_READY bbox: ' +
      finalSize.x.toFixed(2) +
      ' ' +
      finalSize.y.toFixed(2) +
      ' ' +
      finalSize.z.toFixed(2)
  );
}

function resetMorphs() {
  for (const mesh of morphMeshes) {
    for (let i = 0; i < mesh.morphTargetInfluences.length; i++) {
      mesh.morphTargetInfluences[i] = 0;
    }
  }
}

function applyMorph(names, value, timeout = 800) {
  let applied = false;

  for (const mesh of morphMeshes) {
    const dict = mesh.morphTargetDictionary || {};

    for (const key of Object.keys(dict)) {
      const lower = key.toLowerCase();

      if (names.some((name) => lower.includes(name))) {
        mesh.morphTargetInfluences[dict[key]] = value;
        applied = true;
      }
    }
  }

  if (applied) {
    setTimeout(resetMorphs, timeout);
  }

  return applied;
}

function loadAionModel() {
  log('Loading ' + MODEL_URL);

  const loader = new GLTFLoader();

  loader.load(
    MODEL_URL,

    (gltf) => {
      model = gltf.scene || gltf.scenes[0];

      if (!model) {
        fail('GLB loaded, but scene is empty');
        return;
      }

      scene.remove(testCube);

      fitModel(model);
      collectMorphs(model);
      scene.add(model);

      if (gltf.animations && gltf.animations.length > 0) {
        mixer = new THREE.AnimationMixer(model);

        gltf.animations.forEach((clip) => {
          mixer.clipAction(clip).play();
        });

        log('MODEL_READY with animation clips: ' + gltf.animations.length);
      } else {
        log('MODEL_READY: no animation clips, procedural idle active');
      }
    },

    (event) => {
      if (event.total) {
        const percent = Math.round((event.loaded / event.total) * 100);
        log('Loading model ' + percent + '%');
      }
    },

    (error) => {
      fail('GLB load error: ' + (error?.message || String(error)));
    }
  );
}

function setMode(nextMode) {
  mode = nextMode;
  resetMorphs();

  if (nextMode === 'idle') {
    log('Mode: idle');
    return;
  }

  if (nextMode === 'think') {
    log('Mode: think');
    return;
  }

  if (nextMode === 'talk') {
    const ok = applyMorph(
      ['a', 'aa', 'mouth', 'viseme', 'v_aa', 'o', 'oh'],
      0.9,
      650
    );

    if (!ok) {
      log('Mode: talk, but mouth blendshape not found');
    } else {
      log('Mode: talk');
    }

    return;
  }

  if (nextMode === 'happy') {
    const ok = applyMorph(
      ['joy', 'fun', 'happy', 'smile'],
      1,
      1200
    );

    if (!ok) {
      log('Mode: happy, but smile blendshape not found');
    } else {
      log('Mode: happy');
    }

    return;
  }

  if (nextMode === 'dance') {
    log('Dance animation missing in test model');
    return;
  }
}

document.querySelectorAll('[data-mode]').forEach((button) => {
  button.addEventListener('click', () => {
    unlockSpeech();
    setMode(button.dataset.mode);
  });
});

async function sendMessage() {
  unlockSpeech();

  const text = inputEl.value.trim();

  if (!text) {
    return;
  }

  inputEl.value = '';
  log('You: ' + text);
  setMode('think');

  try {
    const response = await fetch(CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: text,
        auth_provider: 'web',
        auth_identifier: 'aion-web3d'
      })
    });

    const raw = await response.text();

    if (!response.ok) {
      throw new Error('HTTP ' + response.status + ': ' + raw);
    }

    let json;

    try {
      json = JSON.parse(raw);
    } catch {
      throw new Error('Backend returned non-JSON: ' + raw);
    }

    const answer = json.answer || json.message || json.reply || '';

    if (!answer) {
      throw new Error('Empty backend answer: ' + raw);
    }

    log('AION: ' + answer);
    setMode('talk');
    speakAion(answer);
  } catch (error) {
    fail('Backend error: ' + (error?.message || String(error)));
    setMode('idle');
  }
}

function speakAion(text) {
  if (!('speechSynthesis' in window)) {
    log('TTS не поддерживается в этом браузере');
    return;
  }

  const utterance = new SpeechSynthesisUtterance(String(text).slice(0, 500));

  utterance.lang = 'ru-RU';
  utterance.rate = 1.0;
  utterance.pitch = 1.08;
  utterance.volume = 1.0;

  const voices = window.speechSynthesis.getVoices();
  const ruVoice = voices.find((voice) =>
    voice.lang && voice.lang.toLowerCase().includes('ru')
  );

  if (ruVoice) {
    utterance.voice = ruVoice;
  }

  utterance.onstart = () => {
    log('AION начала говорить');
    setMode('talk');
  };

  utterance.onend = () => {
    log('AION закончила говорить');
    setMode('idle');
  };

  utterance.onerror = (event) => {
    fail('Ошибка TTS: ' + event.error);
    setMode('idle');
  };

  window.speechSynthesis.cancel();

  setTimeout(() => {
    window.speechSynthesis.speak(utterance);
  }, 80);
}

function startVoice() {
  unlockSpeech();

  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    log('Голосовой ввод в Safari ограничен. Для нормального STT нужен backend.');
    return;
  }

  const recognition = new SpeechRecognition();

  recognition.lang = 'ru-RU';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    log('Voice recognition started');
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    inputEl.value = transcript;
    sendMessage();
  };

  recognition.onerror = (event) => {
    fail('Voice error: ' + event.error);
  };

  recognition.onend = () => {
    log('Voice recognition ended');
  };

  recognition.start();
}

sendBtn.addEventListener('click', sendMessage);
voiceBtn.addEventListener('click', startVoice);

inputEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    sendMessage();
  }
});

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();
  const time = performance.now() / 1000;

  if (mixer) {
    mixer.update(delta);
  }

  if (model) {
    if (mode === 'idle') {
      model.rotation.y = MODEL_FRONT_ROTATION + Math.sin(time * 0.7) * 0.08;
      model.position.y += Math.sin(time * 2.1) * 0.00065;
    }

    if (mode === 'think') {
      model.rotation.y = MODEL_FRONT_ROTATION + Math.sin(time * 1.2) * 0.18;
    }

    if (mode === 'talk') {
      model.rotation.y = MODEL_FRONT_ROTATION + Math.sin(time * 2.6) * 0.06;
    }

    if (mode === 'happy') {
      model.rotation.y = MODEL_FRONT_ROTATION + Math.sin(time * 3.0) * 0.09;
    }
  } else {
    testCube.rotation.x += delta * 0.7;
    testCube.rotation.y += delta * 1.1;
  }

  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => {
    log('TTS voices loaded: ' + window.speechSynthesis.getVoices().length);
  };
}

loadAionModel();
animate();