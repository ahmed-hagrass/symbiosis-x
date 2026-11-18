// Copyright-free, synthesized mission sounds. UI only; never drives mission state.
// A user click enables playback under browser audio autoplay policy.
//
// One small engine for every Flight sound: named cues are routed through
// mixer buses (interface, transitions, ambience, alerts, comms) into a master
// limiter, so no cue clips or jumps out louder than the rest.
function installFlightSoundEffects() {
  const toggle=document.getElementById("flight-audio");
  const STORE="sx-flight-sound";
  let enabled=true,ctx=null,master=null,buses=null,lastHover=0,noiseBuffer=null;
  try { enabled=localStorage.getItem(STORE)!=="off"; } catch {}
  const reduced=()=>window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const LEVELS={ui:.55,transition:.7,ambience:.35,alert:.8,comms:.7};
  function getContext() {
    try {
      const Engine=window.AudioContext || window.webkitAudioContext;
      if (!Engine) return null;
      if (!ctx) {
        ctx=new Engine();
        // Master limiter: catches peaks so stacked cues never clip.
        const limiter=ctx.createDynamicsCompressor();
        limiter.threshold.value=-10;limiter.knee.value=6;limiter.ratio.value=12;
        limiter.attack.value=.003;limiter.release.value=.18;
        master=ctx.createGain();master.gain.value=.9;
        master.connect(limiter).connect(ctx.destination);
        buses={};
        for (const [name,level] of Object.entries(LEVELS)) {
          const bus=ctx.createGain();bus.gain.value=level;bus.connect(master);buses[name]=bus;
        }
      }
      if (ctx.state==="suspended") void ctx.resume();
      return ctx;
    } catch {return null;}
  }
  function out(bus) { return buses?.[bus] ?? master; }
  function tone(frequency,duration,kind="sine",volume=.075,slide=1,{bus="ui",delay=0}={}) {
    if (!enabled) return;
    const ac=getContext();
    if (!ac) return;
    const start=ac.currentTime+.005+delay;
    const osc=ac.createOscillator(),gain=ac.createGain();
    osc.type=kind;
    osc.frequency.setValueAtTime(frequency,start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20,frequency*slide),start+duration);
    gain.gain.setValueAtTime(.0001,start);
    gain.gain.exponentialRampToValueAtTime(Math.max(.001,volume),start+Math.min(.025,duration/3));
    gain.gain.exponentialRampToValueAtTime(.0001,start+duration);
    osc.connect(gain).connect(out(bus));
    osc.start(start);osc.stop(start+duration+.02);
    osc.onended=()=>{osc.disconnect();gain.disconnect();};
  }
  function whiteNoise(ac) {
    if (noiseBuffer) return noiseBuffer;
    const count=ac.sampleRate*2;
    noiseBuffer=ac.createBuffer(1,count,ac.sampleRate);
    const channel=noiseBuffer.getChannelData(0);
    for(let i=0;i<count;i++) channel[i]=Math.random()*2-1;
    return noiseBuffer;
  }
  function noise(duration,volume=.1,cutoff=190,{bus="transition",type="lowpass",to=null,q=.8,delay=0,attack=null}={}) {
    if (!enabled) return;
    const ac=getContext();
    if (!ac) return;
    const src=ac.createBufferSource(),filter=ac.createBiquadFilter(),gain=ac.createGain();
    src.buffer=whiteNoise(ac);src.loop=true;
    filter.type=type;filter.Q.value=q;
    const t=ac.currentTime+.005+delay;
    filter.frequency.setValueAtTime(cutoff,t);
    if (to) filter.frequency.exponentialRampToValueAtTime(to,t+duration);
    gain.gain.setValueAtTime(.0001,t);
    gain.gain.linearRampToValueAtTime(volume,t+(attack ?? Math.min(.55,duration*.22)));
    gain.gain.exponentialRampToValueAtTime(.0001,t+duration);
    src.connect(filter).connect(gain).connect(out(bus));
    src.start(t);src.stop(t+duration+.02);
    src.onended=()=>{src.disconnect();filter.disconnect();gain.disconnect();};
  }
  // Named cues used across Flight. Each cue has a visual counterpart on screen.
  const CUES={
    "zoom-in":()=>{
      const soft=reduced();
      noise(soft?.35:.85,soft?.05:.13,260,{type:"bandpass",to:2600,q:1.1,attack:.32});
      tone(70,soft?.35:.8,"sine",.05,1.6,{bus:"transition"});
    },
    "zoom-out":()=>{
      const soft=reduced();
      noise(soft?.35:.85,soft?.05:.12,2400,{type:"bandpass",to:240,q:1.1,attack:.18});
      tone(110,soft?.35:.8,"sine",.045,.6,{bus:"transition"});
    },
    "arrive":()=>{tone(880,.09,"sine",.03,1.02,{delay:.02});tone(1320,.14,"sine",.022,1,{delay:.09});},
    "menu-open":()=>tone(620,.06,"sine",.028,1.25),
    "menu-close":()=>tone(520,.05,"sine",.02,.8),
    "hover":()=>{
      const now=performance.now();
      if (now-lastHover<70) return;
      lastHover=now;tone(1800,.025,"sine",.006,1);
    },
    "confirm":()=>{tone(660,.07,"sine",.032,1.1);tone(990,.11,"sine",.024,1,{delay:.06});},
    "back":()=>tone(560,.09,"sine",.028,.75),
  };
  function play(name) {
    if (!enabled) return;
    CUES[name]?.();
  }
  function effect(id) {
    if (!enabled) return;
    if (id==="launch-go") {
      // Engine ignition: bass rumble and air plume, then a short ascent swell.
      noise(3.4,.18,260);tone(48,3.3,"sawtooth",.085,1.9,{bus:"transition"});
      tone(84,2.6,"triangle",.045,1.5,{bus:"transition"});
    } else if (id==="launch-separate") {
      noise(.5,.13,950);tone(180,.45,"triangle",.055,.5,{bus:"transition"});
    } else if (["launch-insert","launch-phasing","launch-match"].includes(id)) {
      noise(1.1,.08,520);tone(90,1.0,"sawtooth",.045,1.4,{bus:"transition"});
    } else if (["launch-capture","launch-dock"].includes(id)) {
      tone(420,.18,"sine",.065,1.2);tone(660,.32,"sine",.04,1.15);
    } else if (["launch-abort","show-flight-emergency"].includes(id)) {
      tone(490,.18,"triangle",.055,1.4,{bus:"alert"});tone(680,.3,"triangle",.045,.72,{bus:"alert"});
    } else if (["next-event","step","checkpoint-advance","show-inspector","show-crew","show-workflow"].includes(id)) {
      tone(450,.07,"sine",.022,1.2);
    } else if (id==="launch-coast" || id==="launch-research") {
      tone(540,.14,"sine",.045,1.5);
    }
  }
  function label() {
    if (!toggle) return;
    toggle.textContent=enabled?"🔊 Sounds on":"🔇 Sounds off";
    toggle.setAttribute("aria-label",enabled?"Mute mission sound effects":"Enable mission sound effects");
    toggle.setAttribute("aria-pressed",String(enabled));
  }
  window.sxSound={play,effect,get enabled(){return enabled;}};
  if (!toggle) return;
  toggle.hidden=false;
  label();
  toggle.title="Toggle original synthesized launch and mission effects";
  toggle.addEventListener("click",event=>{
    enabled=!enabled;
    // Remember a person's own choice only; scripted demos never write saves.
    if (event.isTrusted) try { localStorage.setItem(STORE,enabled?"on":"off"); } catch {}
    label();
    if (enabled) tone(600,.11,"sine",.03,1.3);
  });
  document.addEventListener("click",event=>{
    const button=event.target.closest("button");
    if (button && button!==toggle) effect(button.id);
  },true);
  // Quiet tick when the pointer reaches something clickable on the ship.
  document.addEventListener("pointerover",event=>{
    if (event.pointerType!=="mouse") return;
    const target=event.target.closest?.(".zone,.pawn,.hud-menu-trigger,.hud-menu-list button,.cam-crumbs button");
    if (target && !target.contains(event.relatedTarget)) play("hover");
  });
}
installFlightSoundEffects();
