'use strict';

/* =============================================
   AudioEngine
   ============================================= */
const AudioEngine = (() => {
  const audio = document.getElementById('audio-element');
  let _onTimeUpdate = () => {};
  let _onEnded      = () => {};
  let _onLoadedMeta = () => {};

  audio.addEventListener('timeupdate',     () => _onTimeUpdate(audio.currentTime, audio.duration));
  audio.addEventListener('ended',          () => _onEnded());
  audio.addEventListener('loadedmetadata', () => _onLoadedMeta(audio.duration));

  return {
    load(src) {
      audio.src = src;
      audio.load();
    },
    play() {
      // readyState < 2 means audio isn't loaded yet; play() would throw AbortError.
      // Wait for 'canplay' before resolving, then play.
      if (audio.readyState >= 2) {
        return audio.play();
      }
      return new Promise((resolve, reject) => {
        const onReady = () => {
          audio.removeEventListener('canplay', onReady);
          audio.removeEventListener('error',   onErr);
          audio.play().then(resolve).catch(reject);
        };
        const onErr = (e) => {
          audio.removeEventListener('canplay', onReady);
          audio.removeEventListener('error',   onErr);
          reject(e);
        };
        audio.addEventListener('canplay', onReady, { once: true });
        audio.addEventListener('error',   onErr,   { once: true });
      });
    },
    pause()          { audio.pause(); },
    seek(s)          { if (isFinite(audio.duration)) audio.currentTime = s; },
    setVolume(v)     { audio.volume = v; },
    setMuted(m)      { audio.muted = m; },
    get muted()      { return audio.muted; },
    get volume()     { return audio.volume; },
    get duration()   { return audio.duration || 0; },
    get paused()     { return audio.paused; },
    set onTimeUpdate(fn)     { _onTimeUpdate = fn; },
    set onEnded(fn)          { _onEnded = fn; },
    set onLoadedMetadata(fn) { _onLoadedMeta = fn; },
  };
})();

/* =============================================
   TrackManager
   ============================================= */
const TrackManager = (() => {
  const tracks = [
    { title: 'A Veces R&B',   artist: '',  src: 'tracks/a-veces r&b.mp3' },
    { title: 'A Veces',       artist: '',  src: 'tracks/a-veces.mp3' },
    { title: 'Alicia',        artist: '',  src: 'tracks/alicia.mp3' },
    { title: 'Nadie Como Tú', artist: '',  src: 'tracks/nadie-como-tú1.mp3' },
    { title: 'Risk',          artist: '',  src: 'tracks/risk.mp3' },
    { title: 'Tu Risa',       artist: '',  src: 'tracks/tu-risa.mp3' },
  ];
  let idx = 0;

  return {
    getCurrent() { return tracks[idx]; },
    getIndex()   { return idx; },
    next()       { idx = (idx + 1) % tracks.length; return tracks[idx]; },
    prev()       { idx = (idx - 1 + tracks.length) % tracks.length; return tracks[idx]; },
    count() { return tracks.length; },
    addLocal(name, src) {
      tracks.push({ title: name, artist: 'Local File', src });
      return tracks.length - 1;
    },
    goTo(i) {
      idx = i;
      return tracks[idx];
    },
  };
})();

/* =============================================
   TonearmDrag
   Arm rotates around its transform-origin (0,0)
   which is positioned at the assembly element's
   top-left corner — that IS the pivot center.
   ============================================= */
const TonearmDrag = (() => {
  const assembly   = document.getElementById('tonearm-assembly');
  const arm        = document.getElementById('tonearm');
  const stylus     = document.getElementById('stylus-tip');
  const dropRing   = document.getElementById('drop-zone-ring');
  const vinyl      = document.getElementById('vinyl');
  const dragHint   = document.getElementById('drag-hint');

  // CSS rotate(+θ) moves a downward arm to the LEFT (clockwise on screen).
  // Pivot is at the upper-right of the platter.
  // Positive angle → arm tilts LEFT → stylus moves toward/onto the record.
  // Negative angle → arm tilts RIGHT → stylus moves away from the record.
  const REST_ANGLE      = -20;   // arm tilts right → stylus off record
  const PLAY_ANGLE      =  22;   // arm tilts left  → stylus on outer groove
  const MIN_ANGLE       = -45;   // hard stop right (far from record)
  const MAX_ANGLE       =  50;   // hard stop left (near record center)
  const PLAY_THRESHOLD  =   8;   // angle > this → stylus is over the record

  let currentAngle  = REST_ANGLE;
  let isDragging    = false;
  let dragStartAngle = 0;
  let dragStartMouseAngle = 0;
  let hintDismissed = false;

  // Callbacks set by App
  let _onDrop  = null;   // dropped on record
  let _onLift  = null;   // lifted from record

  /* Get pivot center in viewport coords */
  function getPivot() {
    const r = assembly.getBoundingClientRect();
    // The assembly is a 0×0 div; its left,top IS the pivot
    return { x: r.left, y: r.top };
  }

  /* Angle from downward vertical for a CSS-rotated arm.
     CSS rotate(+θ) moves a downward arm clockwise → to the LEFT on screen.
     Formula: atan2(pivot_x - mouse_x, mouse_y - pivot_y)
     → positive when mouse is to the LEFT of pivot (arm over record)
     → negative when mouse is to the RIGHT of pivot (arm parked)          */
  function mouseAngle(clientX, clientY) {
    const p = getPivot();
    return Math.atan2(p.x - clientX, clientY - p.y) * 180 / Math.PI;
  }

  /* Apply angle to arm (no transition) */
  function applyAngle(a) {
    currentAngle = Math.max(MIN_ANGLE, Math.min(MAX_ANGLE, a));
    arm.style.transform = `rotate(${currentAngle}deg)`;
    // Visual feedback: over-record state
    const over = currentAngle > PLAY_THRESHOLD;
    arm.classList.toggle('over-record', over);
    dropRing.classList.toggle('active', isDragging && over);
    vinyl.classList.toggle('drop-target', isDragging && over);
  }

  /* Smooth transition to a target angle */
  function animateTo(angle, duration = 900) {
    arm.style.transition = `transform ${duration}ms cubic-bezier(.4,0,.2,1)`;
    applyAngle(angle);
    setTimeout(() => { arm.style.transition = ''; }, duration + 50);
  }

  /* Start drag */
  function startDrag(clientX, clientY) {
    isDragging = true;
    dragStartAngle = currentAngle;
    dragStartMouseAngle = mouseAngle(clientX, clientY);
    arm.classList.add('dragging');
    document.body.style.userSelect = 'none';
    arm.style.cursor = 'grabbing';
    assembly.style.cursor = 'grabbing';
    if (!hintDismissed) {
      hintDismissed = true;
      dragHint.classList.add('hidden');
    }
  }

  /* Move */
  function moveDrag(clientX, clientY) {
    if (!isDragging) return;
    const delta = mouseAngle(clientX, clientY) - dragStartMouseAngle;
    applyAngle(dragStartAngle + delta);
  }

  /* End drag */
  function endDrag() {
    if (!isDragging) return;
    isDragging = false;
    arm.classList.remove('dragging');
    document.body.style.userSelect = '';
    arm.style.cursor = '';
    assembly.style.cursor = '';
    dropRing.classList.remove('active');
    vinyl.classList.remove('drop-target');

    if (currentAngle > PLAY_THRESHOLD) {
      // Arm is over the record → snap to play position and trigger
      animateTo(PLAY_ANGLE, 400);
      _onDrop && _onDrop();
    } else {
      // Arm is off the record → return to rest
      animateTo(REST_ANGLE, 700);
      _onLift && _onLift();
    }
  }

  /* Event listeners — mouse */
  assembly.addEventListener('mousedown', e => { startDrag(e.clientX, e.clientY); e.preventDefault(); });
  arm.addEventListener('mousedown',      e => { startDrag(e.clientX, e.clientY); e.preventDefault(); });
  document.addEventListener('mousemove', e => moveDrag(e.clientX, e.clientY));
  document.addEventListener('mouseup',   () => endDrag());

  /* Event listeners — touch */
  assembly.addEventListener('touchstart', e => { startDrag(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
  arm.addEventListener('touchstart',      e => { startDrag(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
  document.addEventListener('touchmove',  e => moveDrag(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
  document.addEventListener('touchend',   () => endDrag());

  return {
    snapToRest(animate = true) {
      if (animate) animateTo(REST_ANGLE, 800);
      else applyAngle(REST_ANGLE);
    },
    snapToPlay(animate = true) {
      if (animate) animateTo(PLAY_ANGLE, 1000);
      else applyAngle(PLAY_ANGLE);
    },
    isOverRecord() { return currentAngle < PLAY_THRESHOLD; },
    set onDrop(fn) { _onDrop = fn; },
    set onLift(fn) { _onLift = fn; },
  };
})();

/* =============================================
   AnimationController
   ============================================= */
const AnimationController = (() => {
  const vinyl    = document.getElementById('vinyl');
  const led      = document.getElementById('led');
  const viz      = document.getElementById('visualizer');
  const sysState = document.getElementById('sys-state');

  return {
    setPlaying() {
      vinyl.classList.remove('paused');
      vinyl.classList.add('playing');
      led.classList.add('active');
      viz.classList.add('playing');
      sysState.textContent = 'PLAYING';
    },
    setPaused() {
      vinyl.classList.remove('playing');
      vinyl.classList.add('paused');
      led.classList.remove('active');
      viz.classList.remove('playing');
      sysState.textContent = 'PAUSED';
    },
    setStopped() {
      vinyl.classList.remove('playing', 'paused');
      led.classList.remove('active');
      viz.classList.remove('playing');
      sysState.textContent = 'STANDBY';
    },
    updateLabel(title, artist) {
      document.getElementById('label-title').textContent  = title.toUpperCase();
      document.getElementById('label-artist').textContent = artist;
    },
  };
})();

/* =============================================
   UIController
   ============================================= */
const UIController = (() => {
  const btnPlay      = document.getElementById('btn-play');
  const btnPrev      = document.getElementById('btn-prev');
  const btnNext      = document.getElementById('btn-next');
  const btnMute      = document.getElementById('btn-mute');
  const volSlider    = document.getElementById('volume-slider');
  const volValue     = document.getElementById('vol-value');
  const progressBar  = document.getElementById('progress-bar');
  const fill         = document.getElementById('progress-fill');
  const scan         = document.getElementById('progress-scan');
  const thumb        = document.getElementById('progress-thumb');
  const timeCurrent  = document.getElementById('time-current');
  const timeTotal    = document.getElementById('time-total');
  const fileInput    = document.getElementById('file-input');
  const iconPlay     = btnPlay.querySelector('.icon-play');
  const iconPause    = btnPlay.querySelector('.icon-pause');

  function fmt(s) {
    if (!isFinite(s)) return '0:00';
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  }

  function setPlayIcon()  { iconPlay.classList.remove('hidden'); iconPause.classList.add('hidden'); }
  function setPauseIcon() { iconPause.classList.remove('hidden'); iconPlay.classList.add('hidden'); }

  function updateProgress(current, duration) {
    const pct = duration ? (current / duration) * 100 : 0;
    fill.style.width   = `${pct}%`;
    scan.style.left    = `${pct}%`;
    thumb.style.left   = `${pct}%`;
    timeCurrent.textContent = fmt(current);
  }

  function updateVolTrack(v) {
    volSlider.style.setProperty('--vol-pct', `${v}%`);
    volValue.textContent = v;
  }

  function setMuteIcon(muted) {
    const icon = document.getElementById('icon-vol');
    icon.innerHTML = muted
      ? '<path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z"/>'
      : '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>';
  }

  /* Progress seek */
  let seeking = false;
  function doSeek(e) {
    const r = progressBar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    AudioEngine.seek(pct * AudioEngine.duration);
  }
  progressBar.addEventListener('mousedown',  e => { seeking = true; doSeek(e); });
  document.addEventListener('mousemove',     e => { if (seeking) doSeek(e); });
  document.addEventListener('mouseup',       ()  => { seeking = false; });
  progressBar.addEventListener('touchstart', e => { seeking = true; doSeek(e.touches[0]); }, { passive: true });
  document.addEventListener('touchmove',     e => { if (seeking) doSeek(e.touches[0]); }, { passive: true });
  document.addEventListener('touchend',      ()  => { seeking = false; });

  return {
    init(handlers) {
      btnPlay.addEventListener('click', handlers.togglePlay);
      btnPrev.addEventListener('click', handlers.prev);
      btnNext.addEventListener('click', handlers.next);

      btnMute.addEventListener('click', () => {
        AudioEngine.setMuted(!AudioEngine.muted);
        setMuteIcon(AudioEngine.muted);
      });

      volSlider.addEventListener('input', () => {
        const v = parseInt(volSlider.value, 10);
        AudioEngine.setVolume(v / 100);
        updateVolTrack(v);
        if (v === 0) { AudioEngine.setMuted(true); setMuteIcon(true); }
        else         { AudioEngine.setMuted(false); setMuteIcon(false); }
      });
      updateVolTrack(volSlider.value);

      fileInput.addEventListener('change', e => {
        const files = Array.from(e.target.files);
        if (!files.length) return;
        files.forEach(f => {
          handlers.addLocal(f.name.replace(/\.[^.]+$/, ''), URL.createObjectURL(f));
        });
        // Play the first of the newly added files
        handlers.playFirstAdded(files.length);
        fileInput.value = '';  // allow re-selecting same files
      });

      /* Keyboard shortcuts */
      document.addEventListener('keydown', e => {
        if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
        if (e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); handlers.togglePlay(); }
        else if (e.key === 'ArrowLeft')  handlers.prev();
        else if (e.key === 'ArrowRight') handlers.next();
        else if (e.key === 'm' || e.key === 'M') btnMute.click();
      });

      /* AudioEngine → UI */
      AudioEngine.onTimeUpdate    = updateProgress;
      AudioEngine.onLoadedMetadata = (d) => { timeTotal.textContent = fmt(d); };
    },

    setTrackInfo(title, artist) {
      document.getElementById('track-title').textContent  = title;
      document.getElementById('track-artist').textContent = artist;
    },

    setPlayingState(playing) {
      if (playing) setPauseIcon();
      else         setPlayIcon();
    },

    resetProgress() {
      fill.style.width   = '0%';
      scan.style.left    = '0%';
      thumb.style.left   = '0%';
      timeCurrent.textContent = '0:00';
      timeTotal.textContent   = '0:00';
    },
  };
})();

/* =============================================
   App
   ============================================= */
const App = (() => {
  let isPlaying = false;

  function showOverlay() { document.getElementById('autoplay-overlay').classList.remove('hidden'); }
  function hideOverlay() { document.getElementById('autoplay-overlay').classList.add('hidden'); }

  function startPlayback() {
    AudioEngine.play().then(() => {
      isPlaying = true;
      AnimationController.setPlaying();
      UIController.setPlayingState(true);
      hideOverlay();
    }).catch(() => showOverlay());
  }

  function loadTrack(track, autoPlay = false) {
    AudioEngine.load(track.src);
    UIController.setTrackInfo(track.title, track.artist);
    AnimationController.updateLabel(track.title, track.artist);
    UIController.resetProgress();

    if (autoPlay) {
      TonearmDrag.snapToPlay();
      startPlayback();
    } else {
      TonearmDrag.snapToRest();
      AnimationController.setStopped();
      UIController.setPlayingState(false);
      isPlaying = false;
    }
  }

  const handlers = {
    togglePlay() {
      if (isPlaying) {
        AudioEngine.pause();
        isPlaying = false;
        AnimationController.setPaused();
        UIController.setPlayingState(false);
        TonearmDrag.snapToRest();
      } else {
        TonearmDrag.snapToPlay();
        startPlayback();
      }
    },
    prev()  { loadTrack(TrackManager.prev(), isPlaying); },
    next()  { loadTrack(TrackManager.next(), isPlaying); },
    addLocal(name, src) { TrackManager.addLocal(name, src); },
    playFirstAdded(count) {
      // Jump to the first of the just-added tracks and play
      const firstIdx = TrackManager.count() - count;
      loadTrack(TrackManager.goTo(firstIdx), true);
    },
  };

  return {
    init() {
      UIController.init(handlers);

      /* Tonearm drag → play/pause */
      TonearmDrag.onDrop = () => {
        if (!isPlaying) startPlayback();
      };
      TonearmDrag.onLift = () => {
        if (isPlaying) {
          AudioEngine.pause();
          isPlaying = false;
          AnimationController.setPaused();
          UIController.setPlayingState(false);
        }
      };

      /* Auto-advance */
      AudioEngine.onEnded = () => handlers.next();

      /* Overlay click */
      document.getElementById('autoplay-overlay').addEventListener('click', () => {
        hideOverlay();
        startPlayback();
      });

      /* Load first track and try to autoplay immediately */
      const first = TrackManager.getCurrent();
      loadTrack(first, true);
      AudioEngine.setVolume(0.8);
    },
  };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
