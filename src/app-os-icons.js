// ============================================================
// OS ICONS — inietta lo sprite <symbol> nel DOM (una volta sola)
// ============================================================
// I glifi OS (loghi ufficiali Simple Icons CC0 + 3 glifi originali) vivono in
// lib/os-icon-sprite.js come <symbol id="os-<key>">. Qui li si mette nel DOM così
// che <use href="#os-<key>"> — emesso da lib/os-icon.js — risolva ovunque nella
// pagina. Deve girare PRIMA che un pannello/tile usi le icone: importato presto in
// main.js, e il bundle è l'ultimo <script> del body → document.body esiste già.
// ============================================================
import { osIconSprite } from '../lib/os-icon-sprite.js';

if (typeof document !== 'undefined') {
  const inject = () => {
    if (!document.querySelector('svg[data-os-icons]')) {
      document.body.insertAdjacentHTML('beforeend', osIconSprite());
    }
  };
  if (document.body) inject();
  else document.addEventListener('DOMContentLoaded', inject, { once: true });
}
