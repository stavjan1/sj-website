// SJ marketing site — shared page interactions (V3).
// Loaded by every marketing page. No dependencies.

document.addEventListener('DOMContentLoaded', () => {
    initMobileNav();
    initReveal();
    initShowMore('btn-show-more-services', '.extra-service-card', 'הצג עוד שירותים', 'הצג פחות');
    initShowMore('btn-show-more-guides', '.extra-guide-card', 'הצג עוד מדריכים', 'הצג פחות');
    initContactForm();
});

function initMobileNav() {
    const toggle = document.getElementById('nav-toggle');
    const scrim = document.getElementById('nav-scrim');
    const nav = document.getElementById('site-nav');
    if (!toggle || !nav) return;
    const close = () => {
        document.body.classList.remove('nav-open');
        toggle.setAttribute('aria-expanded', 'false');
    };
    toggle.addEventListener('click', () => {
        const open = document.body.classList.toggle('nav-open');
        toggle.setAttribute('aria-expanded', String(open));
    });
    if (scrim) scrim.addEventListener('click', close);
    nav.addEventListener('click', (e) => { if (e.target.closest('a')) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}

function initReveal() {
    const els = document.querySelectorAll('.rv');
    if (!els.length || !('IntersectionObserver' in window)) {
        els.forEach(el => el.classList.add('on'));
        return;
    }
    const io = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('on');
                io.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1 });
    els.forEach(el => io.observe(el));
}

function initShowMore(btnId, selector, moreLabel, lessLabel) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.addEventListener('click', () => {
        const cards = document.querySelectorAll(selector);
        const expanding = cards.length && cards[0].hidden;
        cards.forEach(card => {
            card.hidden = !expanding;
            if (expanding) card.classList.add('on');
        });
        btn.textContent = expanding ? lessLabel : moreLabel;
    });
}

function initContactForm() {
    const form = document.getElementById('contact-form');
    if (!form) return;
    const feedback = document.getElementById('form-feedback');
    const submitBtn = document.getElementById('btn-form-submit');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const phone = form.querySelector('[name="phone"]');
        if (phone && !/^[0-9\-+ ]{9,15}$/.test(phone.value.trim())) {
            if (feedback) { feedback.textContent = 'מספר הטלפון לא נראה תקין — בדקו אותו רגע.'; feedback.className = 'form-feedback status-danger'; }
            phone.focus();
            return;
        }
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'שולח…'; }
        try {
            const res = await fetch('https://api.web3forms.com/submit', {
                method: 'POST',
                body: new FormData(form),
            });
            if (res.ok) {
                window.location = '/thanks.html';
                return;
            }
            throw new Error('send failed');
        } catch {
            if (feedback) { feedback.textContent = 'השליחה נכשלה. אפשר לנסות שוב, או פשוט להתקשר: 053-530-2887.'; feedback.className = 'form-feedback status-danger'; }
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'שליחת פנייה'; }
        }
    });
}
