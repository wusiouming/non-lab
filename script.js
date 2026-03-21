import { initAudio } from 'app/audio';
import { initUI } from 'app/ui';
import { initBackground } from 'app/background';

document.addEventListener('DOMContentLoaded', () => {
  initBackground();
  const audio = initAudio();
  initUI(audio);
});