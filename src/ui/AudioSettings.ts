import type { AudioManager, AudioChannel } from '@/audio/AudioManager';

/** Root UI owns placement and lifetime. Native range inputs keep keyboard and
 * screen-reader operation available without taking over gameplay shortcuts. */
export function createAudioSettings(audio: AudioManager): { element: HTMLElement; dispose(): void } {
  const element = document.createElement('details');
  element.className = 'audio-settings';
  element.innerHTML = `<summary>Sound</summary><div class="audio-settings-panel">
    <label class="audio-settings-mute"><input type="checkbox" data-mute> Mute all sound</label>
    ${(['master','music','sfx','ambience'] as AudioChannel[]).map(channel => {
      const label = { master:'Master', music:'Music', sfx:'Sound effects', ambience:'Ambience' }[channel];
      return `<label class="audio-settings-row"><span>${label}</span><input type="range" min="0" max="100" step="1" data-channel="${channel}" aria-label="${label} volume"><output data-value="${channel}"></output></label>`;
    }).join('')}
  </div>`;
  const stop = (event: Event) => event.stopPropagation();
  // Native controls must not fire tools or move the player while adjusting.
  for (const event of ['pointerdown','pointerup','keydown','keyup']) element.addEventListener(event, stop);
  const input = (event: Event) => {
    const target = event.target as HTMLInputElement;
    if (target.matches('[data-mute]')) audio.setMuted(target.checked);
    else if (target.dataset.channel) audio.setVolume(target.dataset.channel as AudioChannel, Number(target.value)/100);
    void audio.unlock();
  };
  element.addEventListener('input', input);
  const off = audio.subscribeSettings(settings => {
    element.querySelector<HTMLInputElement>('[data-mute]')!.checked = settings.muted;
    for (const channel of ['master','music','sfx','ambience'] as AudioChannel[]) {
      const value = Math.round(settings[channel]*100);
      element.querySelector<HTMLInputElement>(`[data-channel="${channel}"]`)!.value = String(value);
      element.querySelector<HTMLOutputElement>(`[data-value="${channel}"]`)!.value = `${value}%`;
    }
  });
  return { element, dispose() {
    off(); element.removeEventListener('input',input);
    for (const event of ['pointerdown','pointerup','keydown','keyup']) element.removeEventListener(event,stop);
    element.remove();
  } };
}
