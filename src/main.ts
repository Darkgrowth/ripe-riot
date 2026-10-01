import * as THREE from 'three';
import { Game } from '@/core/Game';
import { Sunpatch } from '@/world/Sunpatch';
import { OrchardClearing } from '@/world/OrchardClearing';
import { HarvestExtraction } from '@/systems/HarvestExtraction';
import { OrchardShell } from '@/ui/OrchardShell';
import { FruitSystem } from '@/fruit/FruitSystem';
import { Economy } from '@/systems/Economy';
import { InteractionSystem } from '@/interaction/InteractionSystem';
import { UIManager } from '@/ui/UIManager';
import { ExpeditionShell } from '@/ui/ExpeditionShell';
import { BUILD_ID } from '@/build';
import { PlayerRagdoll } from '@/player/PlayerRagdoll';
import { PlayerVitals } from '@/player/PlayerVitals';
import { DockRecovery } from '@/player/DockRecovery';
import { EncounterSystem } from '@/enemies/EncounterSystem';
import { KingVine } from '@/boss/KingVine';
import { ViewmodelSystem } from '@/player/ViewmodelSystem';
import { RopeSystem } from '@/systems/RopeSystem';
import { HarvestScoring } from '@/systems/HarvestScoring';
import { ImpactFX } from '@/fx/ImpactFX';
import { ToolInventory } from '@/tools/ToolInventory';
import { Shop } from '@/systems/Shop';
import { HarvestBook } from '@/systems/HarvestBook';
import { LegendaryHarvest } from '@/systems/LegendaryHarvest';
import { Progression } from '@/systems/Progression';
import { AudioManager } from '@/audio/AudioManager';
import { IslandDirector } from '@/systems/IslandDirector';
import { IslandCharacters } from '@/world/IslandCharacters';
import { IslandEventView } from '@/ui/IslandEventView';
import { MultiplayerAuthority } from '@/net/MultiplayerAuthority';
import { SaveSystem } from '@/save/SaveSystem';
import { DebugAPI } from '@/debug/DebugAPI';
import { loadWorkerAsset } from '@/player/WorkerAsset';
import { installDiagnosticWorkerHands, loadWorkerHands } from '@/render/WorkerHands';
import { selectVisualMode } from '@/art/voxel/VisualMode';

const boot = document.getElementById('boot')!;
const bar = boot.querySelector('.bar > i') as HTMLElement;
const status = boot.querySelector('.boot-status') as HTMLElement;

function progress(pct: number, text: string): void {
  bar.style.width = `${pct}%`;
  status.textContent = text;
}

function fail(err: unknown): void {
  const msg = err instanceof Error ? `${err.message}\n\n${err.stack ?? ''}` : String(err);
  status.textContent = 'failed to start';
  const pre = document.createElement('div');
  pre.className = 'boot-error';
  pre.textContent = msg;
  boot.querySelector('.boot-inner')!.appendChild(pre);
  console.error(err);
  (window as unknown as { __RIPE_ERROR: string }).__RIPE_ERROR = msg;
}

async function main(): Promise<void> {
  const comparisonChoice = new URLSearchParams(window.location.search).get('mimicCompare');
  const comparison = comparisonChoice === 'A' || comparisonChoice === 'B' ? comparisonChoice : null;
  const orchardRun = !comparison && new URLSearchParams(window.location.search).get('orchardRun') === '1';
  const visualMode = selectVisualMode(window.location.search, !!comparison);
  (window as unknown as { __RIPE_VISUAL_MODE: string }).__RIPE_VISUAL_MODE = visualMode;
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const game = new Game();
  (window as unknown as { __GAME: Game }).__GAME = game;

  progress(12, 'loading physics');
  const world = orchardRun ? new OrchardClearing(visualMode) : new Sunpatch(!!comparison, visualMode);
  // A provisional spawn; corrected once the terrain exists.
  await game.boot(canvas, new THREE.Vector3(55, 6, 64));
  const visualWarnings: string[] = [];

  // Visual preload precedes synchronous system init. Gameplay can still boot
  // with a conspicuous diagnostic rig if this asset is missing or corrupt.
  const missingWorker = new URLSearchParams(window.location.search).get('workerAsset') === 'missing';
  try {
    await loadWorkerAsset(missingWorker ? '/models/missing-worker.glb'
      : visualMode === 'voxel' ? '/models/worker-detailed-voxel-v1.glb' : '/models/worker.glb');
  } catch (error) {
    console.error('Connected worker asset failed to load', error);
    visualWarnings.push('Worker visual missing; diagnostic avatar active');
  }
  try {
    await loadWorkerHands(visualMode === 'voxel'
      ? '/models/worker-hands-detailed-voxel-v1.glb' : '/models/worker-hands.glb');
  } catch (error) {
    console.error('Connected worker hands failed to load', error);
    installDiagnosticWorkerHands();
    visualWarnings.push('Worker hands missing; diagnostic gloves active');
  }

  progress(30, 'building sunpatch');
  // The debug surface exists before systems initialise so each system can
  // register its own probes and actions as it comes up.
  const debug = new DebugAPI(game);
  game.debug = debug;

  // Order matters: later systems resolve earlier ones by name during init().
  game.add(world);
  game.add(new Economy());
  game.add(new FruitSystem(visualMode));
  game.add(new PlayerRagdoll());
  let evacuatedCargo = 0;
  game.add(new PlayerVitals({
    onLoseUnsecured: () => {
      const hands = game.get<InteractionSystem>('interaction');
      evacuatedCargo = hands.basket.items.length + (hands.carried ? 1 : 0);
      if (orchardRun) { hands.forfeitUnsecured(); return; }
      hands.dropHeld(true);
      hands.tipOutBasket();
    },
    onWipe: () => {
      if (comparison) {
        // A failed comparison fight starts a genuinely fresh fixture. No normal
        // save is loaded or written in this mode, including during unload.
        window.location.reload();
        return;
      }
      const net = game.get<MultiplayerAuthority>('net');
      if (!net.connected && !orchardRun) {
        const kingVine = game.get<KingVine>('kingVine');
        const legendary = game.get<LegendaryHarvest>('legendary');
        if (!kingVine.subdued) kingVine.reset();
        if (legendary.phase === 'failed') legendary.reset();
      }
      world.spawnPlayer(game.player);
      game.get<PlayerVitals>('vitals').restoreAtCheckpoint();
      game.bus.emit('ui:toast', {
        text: orchardRun ? 'Evacuated to the crate' : 'Evacuated to the dock',
        sub: `${evacuatedCargo ? `${evacuatedCargo} unsecured fruit ${orchardRun ? 'lost' : 'left behind'}. ` : 'No cargo lost. '}Banked money and equipment kept. Health restored.`,
        kind: 'bad', ms: 6500,
      });
    },
  }));
  game.add(new EncounterSystem(comparison === 'B' ? 'block' : comparison === 'A' ? 'polygon' : null,
    visualMode === 'voxel'));
  if (!orchardRun) game.add(new KingVine({
    visualStyle: visualMode === 'voxel' ? 'voxel' : 'baseline',
    onDamagePlayer: (victimId, amount, source) => {
      const net = game.get<MultiplayerAuthority>('net');
      if (!net.connected || victimId === net.me) game.get<PlayerVitals>('vitals').damage(amount, source);
      else net.damagePeer(victimId, amount, source);
    },
    onSubdued: () => game.bus.emit('ui:toast', {
      text: 'King Vine subdued', sub: 'Cut the King Melon free, then bring it to the marked pad.',
      kind: 'good', ms: 4500,
    }),
  }));
  game.add(new InteractionSystem());
  if (!comparison) game.add(new DockRecovery());
  game.add(new RopeSystem(visualMode));
  game.add(new HarvestScoring());
  game.add(new ImpactFX());
  game.add(new ToolInventory());
  game.add(new ViewmodelSystem(visualMode));
  if (!orchardRun) game.add(new Shop());
  game.add(new HarvestBook());
  if (orchardRun) game.add(new HarvestExtraction());
  else {
    game.add(new LegendaryHarvest(visualMode));
    game.add(new Progression(!!comparison));
  }
  game.add(new IslandDirector());
  game.add(new AudioManager());
  if (!orchardRun) game.add(new IslandCharacters());
  game.add(new MultiplayerAuthority());
  // The A/B fixture never even constructs SaveSystem: it cannot read, write,
  // or clear the player's auto slot by booting, resetting, or unloading.
  if (!comparison) game.add(new SaveSystem(orchardRun ? { namespace: 'orchard-v1' } : {}));
  game.add(new UIManager(comparison));
  if (!comparison) game.add(orchardRun ? new OrchardShell(BUILD_ID) : new ExpeditionShell(BUILD_ID));
  if (!orchardRun) game.add(new IslandEventView());

  progress(52, 'planting');
  await game.initSystems();
  const encounters = game.get<EncounterSystem>('encounters');
  encounters.onPlayerDamaged = (amount, kind, victimId) => {
    const net = game.get<MultiplayerAuthority>('net');
    if (!net.connected || victimId === net.me) game.get<PlayerVitals>('vitals').damage(amount, kind);
    else net.damagePeer(victimId, amount, kind);
  };
  encounters.onDefeated = (kind, at) => {
    if (orchardRun) {
      game.bus.emit('ui:toast', { text: kind === 'mimic' ? 'Mimic subdued' : 'Snapjaw subdued',
        sub: 'The harvest is the reward. Bring it to the crate.', kind: 'good', ms: 2700 });
      return;
    }
    if (game.get<Progression>('progress').threatsCleared.has(kind)) return;
    // Fighting always pays something. The physical fruit is a second reward
    // for a crew that secures it, never the only way to afford another try.
    game.get<Economy>('economy').add(kind === 'mimic' ? 80 : kind === 'snapjaw' ? 140 : 110, `defeat:${kind}`);
    if (!encounters.hasAuthoredPrize(kind)) game.get<FruitSystem>('fruit').spawnFree(
      kind === 'mimic' ? 'watermelon' : kind === 'snapjaw' ? 'gluefruit' : 'puffmelon',
      at.clone().add(new THREE.Vector3(0, 2.4, 0)));
    game.bus.emit('ui:toast', {
      text: kind === 'mimic' ? 'Mimic Melon subdued' : kind === 'snapjaw' ? 'Snapjaw opened' : 'Spitter Plant silenced',
      sub: 'Base reward banked. Secure the prize for more.', kind: 'good', ms: 3200,
    });
  };
  game.get<AudioManager>('audio').setEventDirector(game.get<IslandDirector>('director'));
  // Position AND orientation: a spawn transform that sets only the position
  // leaves the player looking down whatever axis yaw 0 happens to be.
  if (comparison) {
    game.get<IslandDirector>('director').automatic = false;
    debug.call('characters.enable', false);
    game.get<ToolInventory>('tools').give('aircannon');
    game.player.teleport(world.groundAt(-11, 24, 0.15));
    game.player.yaw = Math.atan2(12, 2);
    game.player.pitch = -0.06;
  } else {
    world.spawnPlayer(game.player);
    if (orchardRun) {
      const tools = game.get<ToolInventory>('tools');
      tools.give('aircannon'); tools.give('net');
      tools.assignSlot(0, 'hand'); tools.assignSlot(1, 'aircannon'); tools.assignSlot(2, 'net');
      tools.equip(0);
    }
  }

  progress(88, 'starting');
  debug.log('boot complete');

  window.addEventListener('resize', () => game.renderer.resize());
  game.renderer.resize(window.innerWidth, window.innerHeight);

  let last = performance.now();
  const origTick = game.tick.bind(game);
  game.tick = (now: number) => {
    debug.noteFrame(now - last);
    last = now;
    origTick(now);
  };

  game.start();
  if (visualWarnings.length) {
    const warning = document.createElement('div');
    warning.id = 'visual-asset-warning';
    warning.setAttribute('role', 'alert');
    warning.textContent = visualWarnings.join(' · ');
    document.body.appendChild(warning);
  }
  progress(100, 'ready');
  setTimeout(() => boot.classList.add('hidden'), 260);
  (window as unknown as { __RIPE_READY: boolean }).__RIPE_READY = true;
}

main().catch(fail);
window.addEventListener('error', (e) => fail(e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => fail(e.reason));

