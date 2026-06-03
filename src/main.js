import './style.css';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const CHAT_URL = 'https://aion-matrix-core.onrender.com/api/chat';
const MODEL_URL = '/models/AION_TEST.glb';

/*
  Модель стояла спиной, поэтому ставим Math.PI.
  Если вдруг после этого станет опять не так — попробуем -Math.PI.
*/
const MODEL_FRONT_ROTATION = Math.PI;

const canvas = document.getElementById('aion-canvas');
const inputEl = document.getElementById('message');
const sendBtn = document.getElementById('send');
const voiceBtn = document.getElementById('voice');

let model = null;
let mixer = null;
let modelRoot = null;

let speechUnlocked = false;
let currentMood = 'idle';
let isSpeaking = false;
let isListening = false;

const morphTargets = {
  mouth: [],
  smile: [],
  blink: []
};

const rigBones = {
  hips: null,
  spine: null,
  chest: null,
  neck: null,
  head: null,
  leftShoulder: null,
  rightShoulder: null,
  leftUpperArm: null,
  rightUpperArm: null,
  leftLowerArm: null,
  rightLowerArm: null,
  leftHand: null,
  rightHand: null
};

const baseRotations = new Map();

function log(...args) {
  console.log('[AION]', ...args);
}

function fail(...args) {
  console.error('[AION]', ...args);
}

function unlockSpeech() {
  if (speechUnlocked) return;
  if (!('speechSynthesis' in window)) return;

  try {
    const utter = new SpeechSynthesisUtterance('');
    utter.volume = 0;
    speechSynthesis.cancel();
    speechSynthesis.speak(utter);
    speechUnlocked = true;
    log('Speech unlocked');
  } catch (e) {
    fail('Speech unlock error:', e);
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
  alpha: true
});

renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

if ('outputColorSpace' in renderer) {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  34,
  window.innerWidth / window.innerHeight,
  0.1,
  100
);

camera.position.set(0, 1.35, 4.1);
camera.lookAt(0, 1.0, 0);

const ambient = new THREE.HemisphereLight(0xffffff, 0x102034, 1.25);
scene.add(ambient);

const keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
keyLight.position.set(3, 7, 4);
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0x67d9ff, 1.0);
rimLight.position.set(-4, 3, -2);
scene.add(rimLight);

const fillLight = new THREE.PointLight(0x4eb8ff, 0.6, 20);
fillLight.position.set(0, 2.4, 2.2);
scene.add(fillLight);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(4.4, 64),
  new THREE.MeshBasicMaterial({
    color: 0x0a2442,
    transparent: true,
    opacity: 0.55
  })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = 0;
scene.add(floor);

const ring = new THREE.Mesh(
  new THREE.RingGeometry(0.8, 1.25, 64),
  new THREE.MeshBasicMaterial({
    color: 0x48c7ff,
    transparent: true,
    opacity: 0.28,
    side: THREE.DoubleSide
  })
);
ring.rotation.x = -Math.PI / 2;
ring.position.y = 0.01;
scene.add(ring);

const grid = new THREE.GridHelper(6, 18, 0x2f96ff, 0x14304c);
grid.position.y = 0.001;
scene.add(grid);

const testOrb = new THREE.Mesh(
  new THREE.SphereGeometry(0.22, 24, 24),
  new THREE.MeshStandardMaterial({
    color: 0x4edaff,
    emissive: 0x0a1f3f,
    roughness: 0.35,
    metalness: 0.1
  })
);
testOrb.position.set(0, 1.15, 0);
scene.add(testOrb);

function findFirstBoneByPatterns(patterns) {
  const bones = [];

  if (!modelRoot) {
    return null;
  }

  modelRoot.traverse((node) => {
    if (node.isBone) {
      bones.push(node);
    }
  });

  for (const bone of bones) {
    const name = bone.name.toLowerCase();

    if (patterns.some((pattern) => name.includes(pattern))) {
      return bone;
    }
  }

  return null;
}

function collectRig() {
  rigBones.hips = findFirstBoneByPatterns(['hips', 'pelvis']);
  rigBones.spine = findFirstBoneByPatterns(['spine']);
  rigBones.chest = findFirstBoneByPatterns(['chest', 'upperchest', 'thorax']);
  rigBones.neck = findFirstBoneByPatterns(['neck']);
  rigBones.head = findFirstBoneByPatterns(['head']);

  rigBones.leftShoulder = findFirstBoneByPatterns([
    'leftshoulder',
    'lshoulder',
    'shoulder_l'
  ]);

  rigBones.rightShoulder = findFirstBoneByPatterns([
    'rightshoulder',
    'rshoulder',
    'shoulder_r'
  ]);

  rigBones.leftUpperArm = findFirstBoneByPatterns([
    'leftupperarm',
    'lupperarm',
    'upperarm_l',
    'left arm'
  ]);

  rigBones.rightUpperArm = findFirstBoneByPatterns([
    'rightupperarm',
    'rupperarm',
    'upperarm_r',
    'right arm'
  ]);

  rigBones.leftLowerArm = findFirstBoneByPatterns([
    'leftlowerarm',
    'lforearm',
    'lowerarm_l',
    'leftforearm'
  ]);

  rigBones.rightLowerArm = findFirstBoneByPatterns([
    'rightlowerarm',
    'rforearm',
    'lowerarm_r',
    'rightforearm'
  ]);

  rigBones.leftHand = findFirstBoneByPatterns([
    'lefthand',
    'lhand',
    'hand_l'
  ]);

  rigBones.rightHand = findFirstBoneByPatterns([
    'righthand',
    'rhand',
    'hand_r'
  ]);

  Object.values(rigBones).forEach((bone) => {
    if (bone && !baseRotations.has(bone)) {
      baseRotations.set(bone, bone.rotation.clone());
    }
  });

  log('Rig collected', rigBones);
}

function collectMorphs() {
  morphTargets.mouth = [];
  morphTargets.smile = [];
  morphTargets.blink = [];

  if (!modelRoot) {
    return;
  }

  modelRoot.traverse((node) => {
    if (
      !node.isMesh ||
      !node.morphTargetDictionary ||
      !node.morphTargetInfluences
    ) {
      return;
    }

    const dict = node.morphTargetDictionary;

    for (const key of Object.keys(dict)) {
      const lower = key.toLowerCase();
      const index = dict[key];

      if (
        lower.includes('mouth') ||
        lower.includes('viseme') ||
        lower.includes('jawopen') ||
        lower === 'aa' ||
        lower.includes('v_aa') ||
        lower.includes('a_') ||
        lower.includes('oh') ||
        lower.includes('o_')
      ) {
        morphTargets.mouth.push({ mesh: node, index });
      }

      if (
        lower.includes('smile') ||
        lower.includes('happy') ||
        lower.includes('joy') ||
        lower.includes('fun')
      ) {
        morphTargets.smile.push({ mesh: node, index });
      }

      if (lower.includes('blink')) {
        morphTargets.blink.push({ mesh: node, index });
      }
    }
  });

  log('Morphs', morphTargets);
}

function resetTrackedMorphs() {
  ['mouth', 'smile', 'blink'].forEach((group) => {
    morphTargets[group].forEach(({ mesh, index }) => {
      mesh.morphTargetInfluences[index] = 0;
    });
  });
}

function setMorphGroup(group, value) {
  morphTargets[group].forEach(({ mesh, index }) => {
    mesh.morphTargetInfluences[index] = value;
  });
}

function fitModel(root) {
  root.rotation.y = MODEL_FRONT_ROTATION;

  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());

  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= box.min.y;

  const box2 = new THREE.Box3().setFromObject(root);
  const size2 = box2.getSize(new THREE.Vector3());

  const fitHeight = 2.15;
  const scale = size2.y > 0 ? fitHeight / size2.y : 1;
  root.scale.setScalar(scale);

  const finalBox = new THREE.Box3().setFromObject(root);
  const finalCenter = finalBox.getCenter(new THREE.Vector3());
  const finalSize = finalBox.getSize(new THREE.Vector3());

  root.position.x -= finalCenter.x;
  root.position.z -= finalCenter.z;
  root.position.y -= finalBox.min.y;

  camera.position.set(
    0,
    finalSize.y * 0.58,
    Math.max(3.0, finalSize.y * 1.7)
  );

  camera.lookAt(0, finalSize.y * 0.53, 0);

  floor.position.y = 0;
  ring.position.y = 0.01;
  grid.position.y = 0.001;

  log('Model fitted', finalSize);
}

function applyBoneRotation(bone, x = 0, y = 0, z = 0) {
  if (!bone) {
    return;
  }

  const base = baseRotations.get(bone);

  if (!base) {
    return;
  }

  bone.rotation.x = base.x + x;
  bone.rotation.y = base.y + y;
  bone.rotation.z = base.z + z;
}

function restoreBasePose() {
  Object.values(rigBones).forEach((bone) => {
    if (!bone) {
      return;
    }

    const base = baseRotations.get(bone);

    if (!base) {
      return;
    }

    bone.rotation.copy(base);
  });
}

function applyRestPose() {
  /*
    Пытаемся опустить руки вниз.
    Если руки будут криво — потом подправим только эти числа.
  */
  applyBoneRotation(rigBones.leftUpperArm, 0.08, 0, 1.18);
  applyBoneRotation(rigBones.rightUpperArm, 0.08, 0, -1.18);

  applyBoneRotation(rigBones.leftLowerArm, 0.02, 0, 0.18);
  applyBoneRotation(rigBones.rightLowerArm, 0.02, 0, -0.18);
}

function detectMood(text) {
  const value = String(text || '').toLowerCase();

  if (
    value.includes('спасибо') ||
    value.includes('люб') ||
    value.includes('супер') ||
    value.includes('класс') ||
    value.includes('рад') ||
    value.includes('хорош') ||
    value.includes('мил') ||
    value.includes('nice') ||
    value.includes('great')
  ) {
    return 'happy';
  }

  if (
    value.includes('?') ||
    value.includes('почему') ||
    value.includes('как') ||
    value.includes('что') ||
    value.includes('зачем') ||
    value.includes('дума') ||
    value.includes('интересно')
  ) {
    return 'think';
  }

  return 'talk';
}

function setMood(mood) {
  currentMood = mood;
}

function speakAion(text) {
  if (!('speechSynthesis' in window)) {
    fail('TTS not supported in this browser');
    return;
  }

  unlockSpeech();

  const utterance = new SpeechSynthesisUtterance(String(text).slice(0, 500));

  utterance.lang = 'ru-RU';
  utterance.rate = 1.0;
  utterance.pitch = 1.05;
  utterance.volume = 1.0;

  const voices = speechSynthesis.getVoices();
  const ruVoice = voices.find((voice) =>
    (voice.lang || '').toLowerCase().includes('ru')
  );

  if (ruVoice) {
    utterance.voice = ruVoice;
  }

  utterance.onstart = () => {
    isSpeaking = true;
    setMood('talk');
  };

  utterance.onend = () => {
    isSpeaking = false;
    setMood('idle');
  };

  utterance.onerror = (event) => {
    fail('TTS error:', event.error);
    isSpeaking = false;
    setMood('idle');
  };

  speechSynthesis.cancel();

  setTimeout(() => {
    speechSynthesis.speak(utterance);
  }, 80);
}

async function sendMessage() {
  unlockSpeech();

  const text = inputEl.value.trim();

  if (!text) {
    return;
  }

  inputEl.value = '';
  setMood('think');

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
      throw new Error(`HTTP ${response.status}: ${raw}`);
    }

    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error('Backend returned invalid JSON');
    }

    const answer = data.answer || data.message || data.reply || '';

    if (!answer) {
      throw new Error('Empty backend answer');
    }

    const mood = detectMood(answer);
    setMood(mood);
    speakAion(answer);
  } catch (error) {
    fail('Backend error:', error);
    setMood('idle');
  }
}

function startVoice() {
  unlockSpeech();

  const Recognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!Recognition) {
    fail('SpeechRecognition not supported here');
    return;
  }

  const recognition = new Recognition();

  recognition.lang = 'ru-RU';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    isListening = true;
    setMood('think');
  };

  recognition.onresult = (event) => {
    const transcript = event.results?.[0]?.[0]?.transcript || '';

    if (transcript) {
      inputEl.value = transcript;
      sendMessage();
    }
  };

  recognition.onerror = (event) => {
    fail('Voice error:', event.error);
    isListening = false;
    setMood('idle');
  };

  recognition.onend = () => {
    isListening = false;

    if (!isSpeaking) {
      setMood('idle');
    }
  };

  recognition.start();
}

function loadModel() {
  const loader = new GLTFLoader();

  loader.load(
    MODEL_URL,

    (gltf) => {
      modelRoot = gltf.scene || gltf.scenes?.[0];

      if (!modelRoot) {
        fail('Model scene is empty');
        return;
      }

      model = modelRoot;
      scene.remove(testOrb);

      modelRoot.traverse((node) => {
        if (node.isMesh) {
          node.frustumCulled = false;

          if (node.material) {
            node.material.transparent = true;
            node.material.needsUpdate = true;
          }
        }
      });

      fitModel(modelRoot);
      scene.add(modelRoot);

      collectRig();
      collectMorphs();

      if (gltf.animations && gltf.animations.length) {
        mixer = new THREE.AnimationMixer(modelRoot);

        gltf.animations.forEach((clip) => {
          mixer.clipAction(clip).play();
        });
      }

      setMood('idle');
      log('Model ready');
    },

    undefined,

    (error) => {
      fail('GLB load error:', error);
    }
  );
}

sendBtn.addEventListener('click', sendMessage);
voiceBtn.addEventListener('click', startVoice);

inputEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    sendMessage();
  }
});

const clock = new THREE.Clock();

function animateRig(time, delta) {
  if (!modelRoot) {
    return;
  }

  restoreBasePose();
  applyRestPose();
  resetTrackedMorphs();

  const breath = Math.sin(time * 2.2) * 0.018;
  const sway = Math.sin(time * 1.1) * 0.04;

  if (rigBones.spine) {
    applyBoneRotation(rigBones.spine, breath * 0.35, 0, 0);
  }

  if (rigBones.chest) {
    applyBoneRotation(rigBones.chest, breath * 0.6, 0, 0);
  }

  if (rigBones.neck) {
    applyBoneRotation(rigBones.neck, breath * 0.3, 0, 0);
  }

  if (rigBones.head) {
    applyBoneRotation(rigBones.head, breath * 0.35, 0, 0);
  }

  if (currentMood === 'idle') {
    if (rigBones.head) {
      applyBoneRotation(rigBones.head, breath * 0.4, sway * 0.35, 0);
    }
  }

  if (currentMood === 'think') {
    if (rigBones.head) {
      applyBoneRotation(rigBones.head, 0.04, 0.12, 0.18);
    }

    if (rigBones.neck) {
      applyBoneRotation(rigBones.neck, 0.02, 0.06, 0.08);
    }

    if (morphTargets.blink.length) {
      setMorphGroup('blink', (Math.sin(time * 5) + 1) * 0.08);
    }
  }

  if (currentMood === 'happy') {
    if (rigBones.head) {
      applyBoneRotation(rigBones.head, -0.02, sway * 0.65, -0.05);
    }

    if (rigBones.chest) {
      applyBoneRotation(rigBones.chest, 0.03, 0, sway * 0.15);
    }

    if (morphTargets.smile.length) {
      setMorphGroup('smile', 0.85);
    }
  }

  if (isListening) {
    if (rigBones.head) {
      applyBoneRotation(rigBones.head, 0.08, 0, 0.07);
    }

    if (rigBones.neck) {
      applyBoneRotation(rigBones.neck, 0.04, 0, 0.03);
    }
  }

  if (isSpeaking) {
    const mouthOpen = (Math.sin(time * 13.5) + 1) * 0.42;
    const talkNod = Math.sin(time * 7.2) * 0.045;

    if (rigBones.head) {
      applyBoneRotation(rigBones.head, talkNod, 0, 0);
    }

    if (rigBones.neck) {
      applyBoneRotation(rigBones.neck, talkNod * 0.45, 0, 0);
    }

    if (rigBones.leftHand) {
      applyBoneRotation(
        rigBones.leftHand,
        0,
        0,
        Math.sin(time * 6.1) * 0.08
      );
    }

    if (rigBones.rightHand) {
      applyBoneRotation(
        rigBones.rightHand,
        0,
        0,
        -Math.sin(time * 6.1) * 0.08
      );
    }

    if (morphTargets.mouth.length) {
      setMorphGroup('mouth', mouthOpen);
    }
  }

  /*
    Фиксируем модель на полу.
    Никакой левитации.
  */
  modelRoot.position.y = 0;

  ring.rotation.z += delta * 0.25;
}

function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();
  const time = performance.now() / 1000;

  if (mixer) {
    mixer.update(delta);
  }

  animateRig(time, delta);
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

if ('speechSynthesis' in window) {
  speechSynthesis.onvoiceschanged = () => {
    log('Voices loaded:', speechSynthesis.getVoices().length);
  };
}

loadModel();
animate();