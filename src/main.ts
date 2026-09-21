import * as THREE from 'three';
import { Game } from '@/core/Game';
import { Sunpatch } from '@/world/Sunpatch';
import { FruitSystem } from '@/fruit/FruitSystem';
import { Economy } from '@/systems/Economy';
import { InteractionSystem } from '@/interaction/InteractionSystem';
import { UIManager } from '@/ui/UIManager';
import { PlayerRagdoll } from '@/player/PlayerRagdoll';
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
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const game = new Game();
  (window as unknown as { __GAME: Game }).__GAME = game;

  progress(12, 'loading physics');
  const world = new Sunpatch();
  // A provisional spawn; corrected once the terrain exists.
  await game.boot(canvas, new THREE.Vector3(55, 6, 64));

  progress(30, 'building sunpatch');
  // The debug surface exists before systems initialise so each system can
  // register its own probes and actions as it comes up.
  const debug = new DebugAPI(game);
  game.debug = debug;

  // Order matters: later systems resolve earlier ones by name during init().
  game.add(world);
  game.add(new Economy());
  game.add(new FruitSystem());
  game.add(new PlayerRagdoll());
  game.add(new InteractionSystem());
  game.add(new RopeSystem());
  game.add(new HarvestScoring());
  game.add(new ImpactFX());
  game.add(new ToolInventory());
  game.add(new ViewmodelSystem());
  game.add(new Shop());
  game.add(new HarvestBook());
  game.add(new LegendaryHarvest());
  game.add(new Progression());
  game.add(new IslandDirector());
  game.add(new AudioManager());
  game.add(new IslandCharacters());
  game.add(new MultiplayerAuthority());
  game.add(new SaveSystem());
  game.add(new UIManager());
  game.add(new IslandEventView());

  progress(52, 'planting');
  await game.initSystems();
  game.get<AudioManager>('audio').setEventDirector(game.get<IslandDirector>('director'));
  // Position AND orientation: a spawn transform that sets only the position
  // leaves the player looking down whatever axis yaw 0 happens to be.
  world.spawnPlayer(game.player);

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
  progress(100, 'ready');
  setTimeout(() => boot.classList.add('hidden'), 260);
  (window as unknown as { __RIPE_READY: boolean }).__RIPE_READY = true;
}

main().catch(fail);
window.addEventListener('error', (e) => fail(e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => fail(e.reason));

