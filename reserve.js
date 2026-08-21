/* SJ הנדסת חשמל — reservist support emblem + certificate.
   Self-injects a floating emblem under the header on any page that loads this
   file. Clicking it opens a translucent "certificate" overlay stating the
   free-consultation commitment to reservists, with call / WhatsApp actions.

   The emblem is drawn here as an original SVG on purpose: the familiar
   "עסק תומך לוחמים" badges belong to certification programmes SJ is not part
   of, and reproducing one would be a false claim. This mark is our own —
   a support ribbon holding the SJ bolt.

   Styles live in styles.css (.sj-mil-*). */
(function () {
  'use strict';

  var CONFIG = {
    tel: 'tel:053-530-2887',
    phoneLabel: '053-530-2887',
    whatsapp: 'https://wa.me/972535302887?text=' +
      encodeURIComponent('היי SJ, אני משרת/ת בצה"ל / כוחות הביטחון / כבאות והצלה ויש לי שאלה בחשמל'),
  };

  var COPY = {
    label: 'תומכים בצה"ל, כוחות הביטחון, כבאות והצלה',
    eyebrow: 'SJ הנדסת חשמל',
    title: 'משרת/ת בצה"ל, בכוחות הביטחון או בכבאות והצלה? אנחנו כאן בשבילך',
    body: 'אנחנו תומכים בך בשעה שהמדינה של כולנו במערכה ממושכת. ' +
      'תרגיש חופשי להתקשר בלי חשש מתשלום — קצר בבית, תקלה או כל בעיה אחרת — ' +
      'ונדאג לעזור לך מכל הלב.',
    points: [
      'ייעוץ טלפוני ואבחון ראשוני — ללא תשלום וללא התחייבות',
      'גם בערב ובסופי שבוע — כשחוזרים הביתה ואף חשמלאי לא עונה, תרימו טלפון',
      'צריך חשמלאי מבצע? נסביר מה נדרש ונפנה אותך לאיש מקצוע אמין',
    ],
    signName: 'סתיו ג\'אן',
    signRole: 'מייסד · מהנדס חשמל · SJ הנדסת חשמל',
  };

  // Original emblem: a service medal — SJ's dashed-ring-and-bolt mark struck in
  // olive, hanging from a ribbon.
  function emblem(cls) {
    return '<svg class="' + cls + '" viewBox="0 0 100 122" aria-hidden="true">' +
      '<g fill="#6f8535">' +
        '<path d="M40 56 L25 113 L40 105 L55 59 Z"/>' +
        '<path d="M60 56 L75 113 L60 105 L45 59 Z"/>' +
      '</g>' +
      '<circle cx="50" cy="42" r="32" fill="#12140f" fill-opacity="0.9" ' +
        'stroke="#9db35f" stroke-width="4" stroke-dasharray="7.5 4.5"/>' +
      '<circle cx="50" cy="42" r="24" fill="none" stroke="#9db35f" ' +
        'stroke-width="1.6" stroke-opacity="0.55"/>' +
      '<path d="M40 80 L60 45 L45 45 L55 15 L35 50 L50 50 Z" fill="#ffaa00" ' +
        'transform="translate(50,42) scale(0.49) translate(-47.5,-47.5)"/>' +
      '</svg>';
  }

  var ICON_PHONE =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">' +
    '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 ' +
    '19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 ' +
    '2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 ' +
    '2.81.7A2 2 0 0 1 22 16.92z"/></svg>';

  var ICON_WA =
    '<svg viewBox="0 0 32 32" fill="currentColor" aria-hidden="true">' +
    '<path d="M16 1C7.716 1 1 7.716 1 16c0 2.68.686 5.197 1.89 7.39L1 31l7.82-2.05A14.936 14.936 0 0 0 ' +
    '16 31c8.284 0 15-6.716 15-15S24.284 1 16 1zm0 27.5a12.44 12.44 0 0 1-6.34-1.73l-.455-.27-4.64 ' +
    '1.22 1.24-4.52-.295-.47A12.45 12.45 0 0 1 3.5 16C3.5 9.096 9.096 3.5 16 3.5S28.5 9.096 28.5 ' +
    '16 22.904 28.5 16 28.5z"/></svg>';

  var ICON_CHECK =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 12.5 5 5L20 6.5"/></svg>';

  var ICON_X =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" ' +
    'stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  function build() {
    var badge = document.createElement('button');
    badge.type = 'button';
    badge.className = 'sj-mil-badge';
    badge.id = 'sj-mil-badge';
    badge.setAttribute('aria-haspopup', 'dialog');
    badge.setAttribute('aria-label', COPY.label + ' — לחצו לפרטים');
    badge.innerHTML = emblem('sj-mil-emblem') +
      '<span class="sj-mil-label">' + COPY.label + '</span>';

    var overlay = document.createElement('div');
    overlay.className = 'sj-mil-overlay';
    overlay.id = 'sj-mil-overlay';
    overlay.innerHTML =
      '<div class="sj-mil-cert" role="dialog" aria-modal="true" aria-labelledby="sj-mil-h">' +
        '<button type="button" class="sj-mil-close" aria-label="סגירה">' + ICON_X + '</button>' +
        // The two saluting figures, if the artwork has been added. Each <img>
        // removes the whole strip if it cannot load, so a missing file leaves
        // the certificate exactly as it was rather than showing broken frames.
        // Two blocks rather than a flat stack: on a phone they read as one
        // column, and on a wide screen they become the two halves of a
        // landscape certificate instead of a tall A4 in the middle of a
        // 27-inch monitor.
        '<div class="sj-mil-head">' +
          emblem('sj-mil-emblem') +
          '<div class="sj-mil-eyebrow">' + COPY.eyebrow + '</div>' +
          '<h2 id="sj-mil-h">' + COPY.title + '</h2>' +
        '</div>' +
        '<div class="sj-mil-text">' +
          '<div class="sj-mil-rule"><span></span></div>' +
          '<p class="sj-mil-body">' + COPY.body + '</p>' +
          '<ul class="sj-mil-points">' +
            COPY.points.map(function (p) {
              return '<li>' + ICON_CHECK + '<span>' + p + '</span></li>';
            }).join('') +
          '</ul>' +
        '</div>' +
        '<div class="sj-mil-foot">' +
          // Small, in the corner, both looking the same way — a mark at the foot
          // of the document rather than a second seal competing with the medal.
          '<div class="sj-mil-salutes">' +
            '<img src="/assets/salute-a.png" alt="" aria-hidden="true" onerror="this.closest(\'.sj-mil-salutes\').remove()">' +
            '<img src="/assets/salute-b.png" alt="" aria-hidden="true" onerror="this.closest(\'.sj-mil-salutes\').remove()">' +
          '</div>' +
          '<div class="sj-mil-sign">' +
            '<div class="who">' + COPY.signName + '</div>' +
            '<div class="role">' + COPY.signRole + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="sj-mil-actions">' +
          '<a class="sj-mil-btn call" href="' + CONFIG.tel + '">' + ICON_PHONE + CONFIG.phoneLabel + '</a>' +
          '<a class="sj-mil-btn wa" href="' + CONFIG.whatsapp + '" target="_blank" rel="noopener noreferrer">' +
            ICON_WA + 'וואטסאפ</a>' +
        '</div>' +
      '</div>';

    document.body.appendChild(badge);
    document.body.appendChild(overlay);

    var closeBtn = overlay.querySelector('.sj-mil-close');
    var cert = overlay.querySelector('.sj-mil-cert');
    var prevOverflow = '';

    // A certificate is looked at, not scrolled — so when the screen is short
    // (a laptop at 125% system scaling is the common case) the whole card is
    // scaled down to fit instead of being cut off. Below 0.62 it stops
    // shrinking and the overlay scrolls, because past that nothing is legible.
    function fit() {
      cert.style.transform = 'none';
      var avail = window.innerHeight - 24;
      var h = cert.offsetHeight;
      if (!h) return;
      var s = Math.min(1, avail / h);
      cert.style.transform = s < 0.999 ? 'scale(' + Math.max(0.62, s).toFixed(3) + ')' : 'none';
    }

    function open() {
      prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      overlay.classList.add('open');
      fit();
      window.addEventListener('resize', fit);
      closeBtn.focus();
    }
    function close() {
      window.removeEventListener('resize', fit);
      overlay.classList.remove('open');
      document.body.style.overflow = prevOverflow;
      badge.focus();
    }

    badge.addEventListener('click', open);
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', function (e) {
      if (!cert.contains(e.target)) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay.classList.contains('open')) close();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
