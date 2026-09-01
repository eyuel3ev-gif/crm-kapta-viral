/**
 * CRM Álvar · Captura de atribución en la landing
 * ------------------------------------------------------------------
 * Pegar en el <head> de TODAS las páginas de la landing (incluida la de
 * confirmación). Es independiente del CRM: se puede desplegar hoy.
 *
 * Qué hace:
 *   1. Lee los parámetros de la URL en la PRIMERA visita.
 *   2. Los guarda 90 días en localStorage (first-touch, D2-V2 §59).
 *   3. Recupera _fbp / _fbc de las cookies de Meta (necesarios para CAPI).
 *   4. Rellena los hidden inputs del formulario justo antes de enviarlo.
 *
 * Regla: la primera atribución NO se sobrescribe. Si el lead vuelve por
 * otro anuncio, se guarda aparte como last-touch, sin tocar la original.
 */
(function () {
  'use strict';

  var KEY_FIRST = 'crm_attr_first';
  var KEY_LAST = 'crm_attr_last';
  var TTL_DAYS = 90;

  var PARAMS = [
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
    'campaign_id', 'adset_id', 'ad_id', 'creative_id', 'placement',
    'fbclid', 'gclid', 'ttclid'
  ];

  function readCookie(name) {
    var m = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
    return m ? decodeURIComponent(m.pop()) : null;
  }

  function collect() {
    var qs = new URLSearchParams(window.location.search);
    var data = { captured_at: new Date().toISOString() };

    PARAMS.forEach(function (p) {
      var v = qs.get(p);
      if (v) data[p] = v.slice(0, 500);
    });

    // Meta espera estos dos para deduplicar y atribuir conversiones server-side.
    data._fbp = readCookie('_fbp');
    data._fbc = readCookie('_fbc') || (data.fbclid ? 'fb.1.' + Date.now() + '.' + data.fbclid : null);

    data.landing_url = window.location.href.slice(0, 1000);
    data.referrer_url = (document.referrer || '').slice(0, 1000);

    return data;
  }

  function hasAdParams(d) {
    return !!(d.utm_source || d.campaign_id || d.ad_id || d.fbclid || d.gclid || d.ttclid);
  }

  function save(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify({
        expires: Date.now() + TTL_DAYS * 864e5,
        data: data
      }));
    } catch (e) { /* modo privado: se ignora, el POST sigue funcionando */ }
  }

  function load(key) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed.expires || parsed.expires < Date.now()) {
        localStorage.removeItem(key);
        return null;
      }
      return parsed.data;
    } catch (e) { return null; }
  }

  // --- 1. Capturar en cada carga -------------------------------------
  var current = collect();
  var first = load(KEY_FIRST);

  if (!first) {
    save(KEY_FIRST, current);        // primera visita de este navegador
    first = current;
  } else if (hasAdParams(current)) {
    save(KEY_LAST, current);         // volvió por otro anuncio: no se pisa el first-touch
  }

  // --- 2. Exponerlo para el formulario -------------------------------
  window.crmAttribution = function () {
    return {
      first_touch: first,
      last_touch: load(KEY_LAST) || null,
      user_agent: navigator.userAgent,
      // La IP la resuelve el backend. Nunca confiar en la que envíe el cliente.
      client_timestamp: new Date().toISOString()
    };
  };

  // --- 3. Inyectar en formularios ------------------------------------
  // El formulario debe tener: <input type="hidden" name="attribution">
  function inject() {
    var inputs = document.querySelectorAll('input[name="attribution"]');
    for (var i = 0; i < inputs.length; i++) {
      inputs[i].value = JSON.stringify(window.crmAttribution());
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }

  // Los formularios embebidos (Tally, Typeform) cargan tarde: se reintenta.
  document.addEventListener('submit', inject, true);
  setTimeout(inject, 1500);
  setTimeout(inject, 4000);
})();
