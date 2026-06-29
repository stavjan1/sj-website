/* SJ Engineering Assistant — public chat widget.
   Self-injects a floating launcher + chat panel on any page that loads this file.
   Talks to the server-side /api/assistant endpoint (scope + system prompt live
   there). Streams replies token-by-token. RTL / Hebrew. */
(function () {
  'use strict';

  // 'sale' = the in-app helper inside /sale; otherwise the public site assistant.
  var MODE = (typeof window !== 'undefined' && window.SJ_ASSISTANT_MODE === 'sale') ? 'sale' : 'public';

  var CONFIG = {
    phone: '053-530-2887',
    tel: 'tel:053-530-2887',
    whatsapp: 'https://wa.me/972535302887?text=%D7%94%D7%99%D7%99%20SJ%2C%20%D7%99%D7%A9%20%D7%9C%D7%99%20%D7%A9%D7%90%D7%9C%D7%94%20%D7%91%D7%97%D7%A9%D7%9E%D7%9C',
    contactPage: MODE === 'sale' ? '../contact.html' : 'contact.html',
    maxUserMessages: 40,
    // No user-facing model picker — the server picks the engine and auto-falls-back
    // (Gemini → DeepSeek → Grok → Cloudflare) when one runs out.
    defaultModel: 'gemini|gemini-2.0-flash',
    providerLabels: { gemini: 'Gemini', deepseek: 'DeepSeek', grok: 'Grok', cloudflare: 'Cloudflare' },
  };

  var COPY = MODE === 'sale' ? {
    title: 'עוזר המערכת',
    subtitle: 'איך משתמשים בכלי?',
    welcome: 'היי! אני העוזר של מערכת הצעות המחיר של SJ. אשמח להסביר איך לעבוד עם הכלי — ניהול פרויקטים, צ\'אט התמחור, עריכת ההצעה, ייצוא PDF, מאגר המחירים וסנכרון Drive. מה תרצה לדעת?',
    suggestions: ['איך יוצרים הצעת מחיר חדשה?', 'איך מוסיפים מחירים למאגר?', 'איך מייצאים PDF?'],
    placeholder: 'שאלה על השימוש במערכת…',
    disclaimer: 'עוזר להפעלת המערכת. לשאלות חשבונאיות/משפטיות התייעצו עם איש מקצוע.',
  } : {
    title: 'העוזר ההנדסי של SJ',
    subtitle: 'שאלות חשמל — תשובה מיידית',
    welcome: 'שלום וברוכים הבאים 🙂 אני העוזר ההנדסי של SJ הנדסת חשמל. אשמח לעזור בכל שאלה על חשמל — תקלות בבית, פחת ומאמ"תים, עמדות טעינה, לוחות, הארקה ובטיחות. שאלות שתלויות בחוק או ברישוי אפנה ישירות ל-SJ. אז במה אפשר לעזור?',
    suggestions: ['הפחת קפץ ולא עולה, מה לעשות?', 'השקע מתחמם — זה מסוכן?', 'מה לבדוק לפני התקנת עמדת טעינה?'],
    placeholder: 'כתבו שאלה על חשמל…',
    disclaimer: 'תשובות כלליות בלבד. במצב חירום נתקו את המפסק הראשי; אש — 102.',
  };

  var selectedModel = CONFIG.defaultModel;
  var WELCOME = COPY.welcome;
  var SUGGESTIONS = COPY.suggestions;

  // Conversation as sent to the API: [{role:'user'|'assistant', content}]
  var messages = [];
  var sending = false;
  var userCount = 0;
  var els = {};

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function build() {
    // Launcher
    var launcher = el('button', 'sj-assist-launcher');
    launcher.id = 'sj-assist-launcher';
    launcher.setAttribute('aria-label', 'פתיחת העוזר ההנדסי של SJ');
    launcher.innerHTML =
      '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>' +
      '<span class="sj-assist-bolt">⚡</span>';
    launcher.addEventListener('click', toggle);

    // Panel
    var panel = el('div', 'sj-assist-panel');
    panel.id = 'sj-assist-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', COPY.title);
    panel.innerHTML =
      '<div class="sj-assist-head">' +
        '<div class="sj-assist-head-id">' +
          '<div class="sj-assist-avatar"><svg viewBox="0 0 100 100" width="22" height="22" fill="currentColor"><path d="M40 80 L60 45 L45 45 L55 15 L35 50 L50 50 Z"/></svg></div>' +
          '<div class="sj-assist-titles"><span class="sj-assist-title">' + COPY.title + '</span><span class="sj-assist-sub"><span class="sj-assist-dot"></span>' + COPY.subtitle + '</span></div>' +
        '</div>' +
        '<div class="sj-assist-head-actions">' +
          '<button class="sj-assist-iconbtn" id="sj-assist-email" title="שליחת השיחה למייל" aria-label="שליחת השיחה למייל">' +
            '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>' +
          '</button>' +
          '<button class="sj-assist-iconbtn" id="sj-assist-close" title="סגירה" aria-label="סגירה">' +
            '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div class="sj-assist-log" id="sj-assist-log" aria-live="polite"></div>' +
      '<div class="sj-assist-suggest" id="sj-assist-suggest"></div>' +
      '<div class="sj-assist-inputbar">' +
        '<textarea id="sj-assist-input" rows="1" placeholder="' + COPY.placeholder + '" aria-label="הקלדת שאלה"></textarea>' +
        '<button id="sj-assist-send" class="sj-assist-send" aria-label="שליחה">' +
          '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4 20-7z"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="sj-assist-disclaimer">' + COPY.disclaimer + '</div>';

    document.body.appendChild(launcher);
    document.body.appendChild(panel);

    els.launcher = launcher;
    els.panel = panel;
    els.log = panel.querySelector('#sj-assist-log');
    els.suggest = panel.querySelector('#sj-assist-suggest');
    els.input = panel.querySelector('#sj-assist-input');
    els.send = panel.querySelector('#sj-assist-send');

    panel.querySelector('#sj-assist-email').addEventListener('click', openEmailForm);
    panel.querySelector('#sj-assist-close').addEventListener('click', close);
    els.send.addEventListener('click', onSend);
    els.input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); }
    });
    els.input.addEventListener('input', autoGrow);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && els.panel.classList.contains('open')) close();
    });
  }

  function autoGrow() {
    els.input.style.height = 'auto';
    els.input.style.height = Math.min(els.input.scrollHeight, 120) + 'px';
  }

  function toggle() { els.panel.classList.contains('open') ? close() : open(); }

  function open() {
    els.panel.classList.add('open');
    els.launcher.classList.add('hidden');
    if (els.log.childElementCount === 0) {
      addBubble('bot', WELCOME);
      renderSuggestions();
    }
    setTimeout(function () { els.input.focus(); }, 120);
  }

  function close() {
    els.panel.classList.remove('open');
    els.launcher.classList.remove('hidden');
  }

  function renderSuggestions() {
    els.suggest.innerHTML = '';
    SUGGESTIONS.forEach(function (s) {
      var b = el('button', 'sj-assist-chip', s);
      b.addEventListener('click', function () { els.input.value = s; onSend(); });
      els.suggest.appendChild(b);
    });
  }

  function clearSuggestions() { els.suggest.innerHTML = ''; }

  function addBubble(role, text) {
    var b = el('div', 'sj-assist-bubble ' + role);
    b.textContent = text || '';
    els.log.appendChild(b);
    scrollDown();
    return b;
  }

  function addContactCard() {
    if (els.log.querySelector('.sj-assist-contact')) return;
    var c = el('div', 'sj-assist-contact');
    c.innerHTML =
      '<a href="' + CONFIG.tel + '"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>' + CONFIG.phone + '</a>' +
      '<a href="' + CONFIG.whatsapp + '" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15l-1.3 4 4.1-1.3A10 10 0 1 0 12 2z"/></svg>וואטסאפ</a>' +
      '<a href="' + CONFIG.contactPage + '"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v12H5.2L4 17.2z"/></svg>צור קשר</a>';
    els.log.appendChild(c);
    scrollDown();
  }

  function scrollDown() { els.log.scrollTop = els.log.scrollHeight; }

  // If the server auto-switched engines (e.g. Gemini quota ran out), let the
  // user know quietly. There's no model picker — the server handles fallback.
  function noteFallback(res) {
    var from = res.headers.get('X-AI-Fallback-From');
    var used = res.headers.get('X-AI-Provider');
    if (!from || !used || from === used) return;
    var fl = CONFIG.providerLabels[from] || from;
    var ul = CONFIG.providerLabels[used] || used;
    els.log.appendChild(el('div', 'sj-assist-note', 'עברנו אוטומטית ל-' + ul + ' ⚡'));
    scrollDown();
  }

  // ── "Email me this conversation" ──
  function openEmailForm() {
    if (els.log.querySelector('.sj-assist-emailform')) return;
    if (!messages.some(function (m) { return m.role === 'user'; })) {
      addBubble('bot', 'אשמח לשלוח לך סיכום! ספרו לי קודם במה אפשר לעזור, ואז נשלח לכם את השיחה למייל.');
      return;
    }
    clearSuggestions();
    var form = el('div', 'sj-assist-emailform');
    form.innerHTML =
      '<div class="sj-assist-ef-title">✉️ נשמח לשלוח לך את סיכום השיחה למייל</div>' +
      '<input type="text" class="sj-assist-ef-name" placeholder="שם מלא" autocomplete="name">' +
      '<input type="email" class="sj-assist-ef-email" placeholder="כתובת מייל" autocomplete="email">' +
      '<div class="sj-assist-ef-row">' +
        '<button type="button" class="sj-assist-ef-send">שליחה</button>' +
        '<button type="button" class="sj-assist-ef-cancel">ביטול</button>' +
      '</div>' +
      '<div class="sj-assist-ef-msg"></div>';
    els.log.appendChild(form);
    scrollDown();
    var nameI = form.querySelector('.sj-assist-ef-name');
    var emailI = form.querySelector('.sj-assist-ef-email');
    var msg = form.querySelector('.sj-assist-ef-msg');
    form.querySelector('.sj-assist-ef-cancel').addEventListener('click', function () { form.remove(); });
    form.querySelector('.sj-assist-ef-send').addEventListener('click', function () { submitEmail(form, nameI, emailI, msg); });
    emailI.addEventListener('keydown', function (e) { if (e.key === 'Enter') submitEmail(form, nameI, emailI, msg); });
    setTimeout(function () { nameI.focus(); }, 60);
  }

  function submitEmail(form, nameI, emailI, msg) {
    var name = (nameI.value || '').trim();
    var email = (emailI.value || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      msg.textContent = 'נא להזין כתובת מייל תקינה.'; msg.className = 'sj-assist-ef-msg err'; return;
    }
    var btn = form.querySelector('.sj-assist-ef-send');
    btn.disabled = true; btn.textContent = 'שולח…';
    msg.textContent = ''; msg.className = 'sj-assist-ef-msg';
    var parts = String(selectedModel).split('|');
    fetch('/api/lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, email: email, messages: messages, provider: parts[0], model: parts[1] }),
    })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (res.ok && res.d && res.d.ok) {
          form.remove();
          addBubble('bot', res.d.message || 'נשלח! נחזור אליך בהקדם.');
        } else {
          btn.disabled = false; btn.textContent = 'שליחה';
          msg.textContent = (res.d && res.d.error && res.d.error.message) || 'השליחה נכשלה. נסו שוב.';
          msg.className = 'sj-assist-ef-msg err';
        }
      })
      .catch(function () {
        btn.disabled = false; btn.textContent = 'שליחה';
        msg.textContent = 'שגיאת רשת. נסו שוב או התקשרו 053-530-2887.';
        msg.className = 'sj-assist-ef-msg err';
      });
  }

  function setBusy(on) {
    sending = on;
    els.send.disabled = on;
    els.input.disabled = on;
  }

  function typingBubble() {
    var b = el('div', 'sj-assist-bubble bot sj-assist-typing');
    b.innerHTML = '<span></span><span></span><span></span>';
    els.log.appendChild(b);
    scrollDown();
    return b;
  }

  function onSend() {
    if (sending) return;
    var text = (els.input.value || '').trim();
    if (!text) return;

    if (userCount >= CONFIG.maxUserMessages) {
      addBubble('bot', 'הגענו לסוף השיחה כאן 🙂 לפנייה אישית ומקצועית, דברו ישירות עם SJ:');
      addContactCard();
      return;
    }
    userCount++;

    clearSuggestions();
    addBubble('user', text);
    messages.push({ role: 'user', content: text });
    els.input.value = '';
    autoGrow();

    var typing = typingBubble();
    setBusy(true);
    streamReply(typing);
  }

  function streamReply(typingEl) {
    var parts = String(selectedModel).split('|');
    fetch('/api/assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: parts[0], model: parts[1], mode: MODE, messages: messages }),
    })
      .then(function (res) {
        noteFallback(res);
        var ctype = res.headers.get('content-type') || '';
        if (!res.ok) {
          return res.json().catch(function () { return null; }).then(function (data) {
            throw new Error((data && data.error && data.error.message) || 'שגיאה זמנית בשירות.');
          });
        }
        if (res.body && ctype.indexOf('event-stream') !== -1) {
          return consumeStream(res, typingEl);
        }
        // Non-streaming fallback
        return res.json().then(function (data) {
          var txt = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
          finishReply(typingEl, txt || 'מצטער, לא הצלחתי לענות כרגע.');
        });
      })
      .catch(function (err) {
        if (typingEl && typingEl.parentNode) typingEl.remove();
        addBubble('bot', 'מצטער, יש תקלה זמנית בשירות. אפשר לנסות שוב, או לפנות ישירות ל-SJ:');
        addContactCard();
        setBusy(false);
      });
  }

  function consumeStream(res, typingEl) {
    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    var full = '';
    var bubble = null;

    function pump() {
      return reader.read().then(function (r) {
        if (r.done) { finishReply(bubble || typingEl, full); return; }
        buffer += decoder.decode(r.value, { stream: true });
        var nl;
        while ((nl = buffer.indexOf('\n')) !== -1) {
          var line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (line.indexOf('data:') !== 0) continue;
          var p = line.slice(5).trim();
          if (!p || p === '[DONE]') continue;
          try {
            var j = JSON.parse(p);
            var d = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
            if (d) {
              full += d;
              if (!bubble) { if (typingEl && typingEl.parentNode) typingEl.remove(); bubble = addBubble('bot', ''); }
              bubble.textContent = full;
              scrollDown();
            }
          } catch (e) { /* ignore partial */ }
        }
        return pump();
      });
    }
    return pump();
  }

  function finishReply(bubbleOrTyping, text) {
    if (bubbleOrTyping && bubbleOrTyping.classList && bubbleOrTyping.classList.contains('sj-assist-typing')) {
      if (bubbleOrTyping.parentNode) bubbleOrTyping.remove();
      bubbleOrTyping = addBubble('bot', text || '');
    } else if (bubbleOrTyping) {
      bubbleOrTyping.textContent = text || bubbleOrTyping.textContent;
    }
    var reply = text || '';
    messages.push({ role: 'assistant', content: reply });
    // When the bot hands off to SJ, surface the contact card.
    if (/SJ|סתיו|חשמלאי מוסמך|מהנדס|צרו? קשר|פרטי הקשר|053/.test(reply)) addContactCard();
    setBusy(false);
    scrollDown();
    els.input.focus();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
