import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
gsap.registerPlugin(ScrollTrigger);

// ─── RENDERER ───────────────────────────────────────────────────────────────
const canvas = document.getElementById('hero-canvas');
const renderer = new THREE.WebGLRenderer({
  canvas, alpha: true, antialias: true, powerPreference: 'high-performance'
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.64;
renderer.outputColorSpace = THREE.SRGBColorSpace;

// ─── SCENE & CAMERA ─────────────────────────────────────────────────────────
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 0, 5.5);

// ─── REFLECTION ENVIRONMENT (gives the ball real shine) ─────────────────────
const pmrem = new THREE.PMREMGenerator(renderer);
pmrem.compileEquirectangularShader();
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

// ─── LIGHTING ───────────────────────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0xfff0dd, 0.55));
const keyLight = new THREE.DirectionalLight(0xffeedd, 1.6);
keyLight.position.set(-2, 4, 5);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xf5e8d0, 0.35);
fillLight.position.set(4, 1, -2);
scene.add(fillLight);
scene.add(new THREE.HemisphereLight(0xfff0dd, 0xcfc0ae, 0.4));

// ─── BALL STATE ─────────────────────────────────────────────────────────────
let ball = null;
let ballLoaded = false;
let baseScale = 1;
let currentSection = 'hero';

// ─── SECTION WAYPOINTS ──────────────────────────────────────────────────────
// Smaller scales, repositioned so the ball never blocks content.
// BALL_SCALE 1.77 = 2.5× increase from 0.71.
// Each section has a DIFFERENT y so the ball visibly moves as you scroll.
const BALL_SCALE = 0.97;          // +10% from 0.885
const FOOTER_SCALE = 0.5;          // shrunk specifically for footer (per user)
const SECTIONS = {
  hero:   { x: 0.5,   y: -0.45, z: 0,    scale: BALL_SCALE   }, // pulled right so text overlaps ball
  stats:  { x: 2.2,   y:  0.0,  z: 0,    scale: BALL_SCALE   },
  how:    { x: -2.2,  y:  0.0,  z: 0,    scale: BALL_SCALE   },
  footer: { x: 2.5,   y: -1.3,  z: -2.0, scale: FOOTER_SCALE }, // small, far corner, pushed back
};

// ─── LOAD BALL ──────────────────────────────────────────────────────────────
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader);

loader.load('/models/basketball.glb', (gltf) => {
  ball = gltf.scene;

  const box = new THREE.Box3().setFromObject(ball);
  const center = box.getCenter(new THREE.Vector3());
  ball.position.sub(center);

  const size = box.getSize(new THREE.Vector3());
  baseScale = 2.4 / Math.max(size.x, size.y, size.z);
  ball.scale.setScalar(baseScale * SECTIONS.hero.scale);
  ball.position.set(SECTIONS.hero.x, SECTIONS.hero.y, SECTIONS.hero.z);

  // Boost shine on every mesh
  ball.traverse((child) => {
    if (child.isMesh && child.material) {
      const m = child.material;
      m.envMapIntensity = 0.15;
      if (m.roughness !== undefined) m.roughness = Math.min(1.0, Math.max(0.82, (m.roughness ?? 0.5) * 1.55));
      if (m.metalness !== undefined) m.metalness = 0;
      if (m.color) m.color.multiplyScalar(0.68); // gritty darker tone
      m.needsUpdate = true;
    }
  });

  scene.add(ball);
  ballLoaded = true;
  ballEntrance();
}, undefined, (err) => console.error('GLB Error:', err));

// ─── ENTRANCE (one-time only — no continuous motion) ────────────────────────
function ballEntrance() {
  if (!ball) return;
  const targetS = baseScale * SECTIONS.hero.scale;
  ball.scale.setScalar(targetS * 0.25);

  gsap.to(ball.scale, {
    x: targetS, y: targetS, z: targetS,
    duration: 1.3, ease: 'expo.out', delay: 0.5,
    onComplete: () => enableDrag()
  });
  gsap.fromTo(ball.position,
    { y: SECTIONS.hero.y - 0.8 },
    { y: SECTIONS.hero.y, duration: 1.3, ease: 'expo.out', delay: 0.5 }
  );
  // NOTE: no rotation tween — ball stays put after landing
}

// ─── DRAG PHYSICS (only motion source — user-driven) ─────────────────────────
let isDragging = false;
let prevMouse = { x: 0, y: 0 };
let velocity = { x: 0, y: 0 };
const DAMPING = 0.94;
let momentumRAF = null;
// Random initial auto-rotation direction
const BASE_SPEED = 0.003;
let autoVel = {
  x: (Math.random() - 0.5) * 0.003,
  y: BASE_SPEED + Math.random() * 0.002,
};

function enableDrag()  { canvas.classList.add('drag-enabled'); }
function disableDrag() { canvas.classList.remove('drag-enabled'); }

function getPos(e) {
  if (e.touches && e.touches.length) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  return { x: e.clientX, y: e.clientY };
}

function onDragStart(e) {
  if (!ballLoaded || currentSection !== 'hero') return;
  isDragging = true;
  prevMouse = getPos(e);
  velocity = { x: 0, y: 0 };
  if (momentumRAF) cancelAnimationFrame(momentumRAF);
}
function onDragMove(e) {
  if (!isDragging || !ball) return;
  if (e.cancelable) e.preventDefault();
  const pos = getPos(e);
  velocity.x = (pos.y - prevMouse.y) * 0.006;
  velocity.y = (pos.x - prevMouse.x) * 0.006;
  ball.rotation.x += velocity.x;
  ball.rotation.y += velocity.y;
  prevMouse = { ...pos };
}
function onDragEnd() {
  if (!isDragging) return;
  isDragging = false;
  applyMomentum();
}
function applyMomentum() {
  if (!ball) return;
  velocity.x *= DAMPING;
  velocity.y *= DAMPING;
  ball.rotation.x += velocity.x;
  ball.rotation.y += velocity.y;
  if (Math.abs(velocity.x) + Math.abs(velocity.y) > 0.0003) {
    momentumRAF = requestAnimationFrame(applyMomentum);
  } else {
    // Continue spinning in the direction the user last threw it
    const speed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y);
    if (speed > 0.00005) {
      autoVel = { x: velocity.x / speed * BASE_SPEED, y: velocity.y / speed * BASE_SPEED };
    }
    velocity = { x: 0, y: 0 };
  }
}

canvas.addEventListener('mousedown', onDragStart);
window.addEventListener('mousemove', onDragMove);
window.addEventListener('mouseup', onDragEnd);
canvas.addEventListener('touchstart', onDragStart, { passive: false });
window.addEventListener('touchmove', onDragMove, { passive: false });
window.addEventListener('touchend', onDragEnd);

// ─── SCROLL-DRIVEN BALL POSITIONING ──────────────────────────────────────────
function lerp(a, b, t) { return a + (b - a) * t; }
function easeInOut(t) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; }

// Depth recession: the lower the ball on screen, the further it recedes.
// Gives a premium parallax-depth feel — ball shrinks as it "sinks."
function depthOffset(y) { return Math.min(0, y) * 0.3; }

function setupScrollBall() {
  // Hero → Stats
  ScrollTrigger.create({
    trigger: '#stats-section',
    start: 'top bottom', end: 'top top', scrub: 2,
    onUpdate: (self) => {
      if (!ball || isDragging) return;
      const t = self.progress;
      const ly = lerp(SECTIONS.hero.y, SECTIONS.stats.y, easeInOut(t));
      ball.position.x = lerp(SECTIONS.hero.x, SECTIONS.stats.x, t);
      ball.position.y = ly;
      ball.position.z = lerp(SECTIONS.hero.z, SECTIONS.stats.z, t) + depthOffset(ly);
      ball.scale.setScalar(lerp(baseScale * SECTIONS.hero.scale, baseScale * SECTIONS.stats.scale, t));
    },
    onEnter: () => { disableDrag(); currentSection = 'stats'; },
    onLeaveBack: () => { currentSection = 'hero'; enableDrag(); }
  });

  // Stats → How
  ScrollTrigger.create({
    trigger: '#how-section',
    start: 'top bottom', end: 'top top', scrub: 2,
    onUpdate: (self) => {
      if (!ball || isDragging) return;
      const t = self.progress;
      const ly = lerp(SECTIONS.stats.y, SECTIONS.how.y, easeInOut(t));
      ball.position.x = lerp(SECTIONS.stats.x, SECTIONS.how.x, t);
      ball.position.y = ly;
      ball.position.z = lerp(SECTIONS.stats.z, SECTIONS.how.z, t) + depthOffset(ly);
      ball.scale.setScalar(lerp(baseScale * SECTIONS.stats.scale, baseScale * SECTIONS.how.scale, t));
    },
    onEnter:     () => { currentSection = 'how'; },
    onLeaveBack: () => { currentSection = 'stats'; }
  });

  // How → Footer
  ScrollTrigger.create({
    trigger: '#site-footer',
    start: 'top bottom', end: 'top top', scrub: 2,
    onUpdate: (self) => {
      if (!ball || isDragging) return;
      const t = self.progress;
      const ly = lerp(SECTIONS.how.y, SECTIONS.footer.y, easeInOut(t));
      ball.position.x = lerp(SECTIONS.how.x, SECTIONS.footer.x, t);
      ball.position.y = ly;
      ball.position.z = lerp(SECTIONS.how.z, SECTIONS.footer.z, t) + depthOffset(ly);
      ball.scale.setScalar(lerp(baseScale * SECTIONS.how.scale, baseScale * SECTIONS.footer.scale, t));
    },
    onEnter:     () => { currentSection = 'footer'; },
    onLeaveBack: () => { currentSection = 'how'; }
  });
}

// ─── UI ENTRANCE ANIMATIONS ──────────────────────────────────────────────────
const navTL = gsap.timeline({ delay: 0.15 });
navTL
  .to('.nav-logo',    { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' }, 0.1)
  .to('.nav-links',   { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' }, 0.15)
  .to('.profile-btn', { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' }, 0.2)
  .to('#ph-badge',    { opacity: 1, y: 0, duration: 0.7, ease: 'expo.out'   }, 0.4)
  .to('#event-card',  { opacity: 1, x: 0, duration: 1.1, ease: 'expo.out'   }, 0.55)
  .to('#hero-text',   { opacity: 1, x: 0, duration: 1.1, ease: 'expo.out'   }, 0.65)
  .to('#nav-arrow',   { opacity: 1,        duration: 0.5, ease: 'power2.out' }, 1.1)
  .to('#sig-wrap',    { opacity: 1, y: 0,  duration: 0.4, ease: 'power2.out' }, 1.2)
  .to('.sp1',         { strokeDashoffset: 0, duration: 1.6, ease: 'power2.inOut' }, 1.2)
  .to('.sp2',         { strokeDashoffset: 0, duration: 1.0, ease: 'power2.inOut' }, 1.8)
  .to('.sp3',         { strokeDashoffset: 0, duration: 0.7, ease: 'power2.inOut' }, 2.0);

// Stats — animate in on scroll
ScrollTrigger.create({
  trigger: '#stats-section', start: 'top 75%',
  onEnter: () => {
    gsap.to('.stat-card', { opacity: 1, y: 0, duration: 0.8, ease: 'expo.out', stagger: 0.1, delay: 0.1 });
  }
});

// How — animate steps in
ScrollTrigger.create({
  trigger: '#how-section', start: 'top 70%',
  onEnter: () => {
    gsap.to('.step-item', { opacity: 1, x: 0, duration: 0.9, ease: 'expo.out', stagger: 0.15, delay: 0.1 });
  }
});

// Navbar glass on scroll
const navEl = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  navEl.classList.toggle('scrolled', window.scrollY > 80);
}, { passive: true });

// ─── EVENT CARD — premium hover (scale + lift) ──────────────────────────────
const eventCardEl = document.getElementById('event-card');
if (eventCardEl) {
  eventCardEl.addEventListener('mouseenter', () => {
    gsap.to(eventCardEl, {
      scale: 1.035, y: -6,
      duration: 0.55, ease: 'power3.out', overwrite: 'auto'
    });
  });
  eventCardEl.addEventListener('mouseleave', () => {
    gsap.to(eventCardEl, {
      scale: 1.0, y: 0,
      duration: 0.55, ease: 'power3.out', overwrite: 'auto'
    });
  });
}

// ─── RESIZE ─────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});

// ─── RENDER LOOP ────────────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);
  if (ball && !isDragging) {
    ball.rotation.x += autoVel.x;
    ball.rotation.y += autoVel.y;
  }
  renderer.render(scene, camera);
}
animate();

window.addEventListener('load', () => {
  setupScrollBall();
  ScrollTrigger.refresh();
});
