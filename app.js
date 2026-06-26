// Interactive Features for SJ Electrical Engineering Homepage

document.addEventListener('DOMContentLoaded', () => {
    initHeaderScroll();
    initMobileMenu();
    initScrollReveal();
    initStatsCounter();
    initContactForm();
    initSmoothScrollMobile();
    initCursorGlow();
    initFaqAccordion();
    initCertsAccordion();
});


/**
 * 1. Change header styling when user scrolls down
 */
function initHeaderScroll() {
    const header = document.getElementById('main-header');
    
    const checkScroll = () => {
        if (window.scrollY > 50) {
            header.classList.add('scrolled');
        } else {
            header.classList.remove('scrolled');
        }
    };
    
    window.addEventListener('scroll', checkScroll);
    checkScroll(); // Initial check on load
}

/**
 * 2. Mobile drawer menu functionality
 */
function initMobileMenu() {
    const toggleBtn = document.getElementById('mobile-menu-toggle');
    const drawer = document.getElementById('mobile-drawer');
    
    if (!toggleBtn || !drawer) return;
    
    const toggleMenu = () => {
        const isOpen = drawer.classList.toggle('open');
        toggleBtn.classList.toggle('open');
        toggleBtn.setAttribute('aria-expanded', isOpen);
    };
    
    toggleBtn.addEventListener('click', toggleMenu);
    
    // Close drawer when clicking outside it or on a link
    document.addEventListener('click', (e) => {
        if (drawer.classList.contains('open') && 
            !drawer.contains(e.target) && 
            e.target !== toggleBtn && 
            !toggleBtn.contains(e.target)) {
            toggleMenu();
        }
    });
}

/**
 * 3. Close mobile drawer on link navigation
 */
function initSmoothScrollMobile() {
    const mobileLinks = document.querySelectorAll('.mobile-nav-link');
    const drawer = document.getElementById('mobile-drawer');
    const toggleBtn = document.getElementById('mobile-menu-toggle');
    
    mobileLinks.forEach(link => {
        link.addEventListener('click', () => {
            if (drawer.classList.contains('open')) {
                drawer.classList.remove('open');
                toggleBtn.classList.remove('open');
            }
        });
    });
}

/**
 * 4. Scroll Reveal Animations (Intersection Observer)
 */
function initScrollReveal() {
    const revealElements = document.querySelectorAll('.reveal');
    
    const observerOptions = {
        root: null,
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px' // Trigger slightly before element is in full view
    };
    
    const observer = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('active');
                obs.unobserve(entry.target); // Stop observing once animated
            }
        });
    }, observerOptions);
    
    revealElements.forEach(el => observer.observe(el));
}

/**
 * 5. Animated Counter for Stats Section (Intersection Observer)
 */
function initStatsCounter() {
    const statsSection = document.getElementById('stats');
    const statNumbers = document.querySelectorAll('.stat-number');
    
    if (!statsSection || statNumbers.length === 0) return;
    
    const runCounter = () => {
        statNumbers.forEach(stat => {
            const target = parseInt(stat.getAttribute('data-target'), 10);
            const duration = 2000; // Animation duration in milliseconds
            const startTime = performance.now();
            
            const updateCount = (currentTime) => {
                const elapsed = currentTime - startTime;
                const progress = Math.min(elapsed / duration, 1);
                
                // Ease-out function for smooth transition at the end
                const easeOutQuad = (t) => t * (2 - t);
                const currentCount = Math.floor(easeOutQuad(progress) * target);
                
                stat.textContent = currentCount;
                
                if (progress < 1) {
                    requestAnimationFrame(updateCount);
                } else {
                    stat.textContent = target; // Ensure exact final number
                }
            };
            
            requestAnimationFrame(updateCount);
        });
    };
    
    const observer = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                runCounter();
                obs.unobserve(entry.target); // Run animation once
            }
        });
    }, { threshold: 0.3 });
    
    observer.observe(statsSection);
}

/**
 * 6. Contact Form Validation and Submission (Netlify Forms)
 */
function initContactForm() {
    const form = document.getElementById('contact-form');
    const feedback = document.getElementById('form-feedback');
    const submitBtn = document.getElementById('btn-form-submit');
    
    if (!form || !feedback) return;
    
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        
        // Basic inputs
        const name = document.getElementById('form-name').value.trim();
        const phone = document.getElementById('form-phone').value.trim();
        
        if (!name || !phone) {
            showFeedback('אנא מלא את כל שדות החובה (*)', 'error');
            return;
        }
        
        // Basic Phone validation (Israeli format/numbers)
        const phoneRegex = /^[0-9\-+]{9,15}$/;
        if (!phoneRegex.test(phone.replace(/\s+/g, ''))) {
            showFeedback('אנא הזן מספר טלפון תקין', 'error');
            return;
        }
        
        // Disable submit button and show loading state
        submitBtn.disabled = true;
        const originalText = submitBtn.textContent;
        submitBtn.textContent = 'שולח...';
        
        const formData = new FormData(form);

        fetch('https://api.web3forms.com/submit', {
            method: 'POST',
            body: formData
        })
        .then(() => {
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
            showFeedback('תודה! פנייתך התקבלה בהצלחה. נחזור אליך בהקדם האפשרי 🎉', 'success');
            form.reset();
        })
        .catch(() => {
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
            showFeedback('שגיאה בשליחה. אנא נסה שוב או פנה אלינו ישירות בטלפון.', 'error');
        });
    });
    
    function showFeedback(message, type) {
        feedback.textContent = message;
        feedback.className = 'form-feedback ' + type;
        
        // Clear message after 6 seconds
        setTimeout(() => {
            feedback.textContent = '';
            feedback.className = 'form-feedback';
        }, 6000);
    }
}

/**
 * 7. Cursor Glow Spotlight effect following mouse movement
 */
function initCursorGlow() {
    const glow = document.getElementById('cursor-glow');
    if (!glow) return;

    const lightSections = ['.services-section'];

    if (window.matchMedia('(hover: hover)').matches) {
        document.addEventListener('mousemove', (e) => {
            glow.style.left = `${e.clientX}px`;
            glow.style.top = `${e.clientY}px`;
            glow.style.opacity = '1';

            // Switch to dark multiply glow on light-background sections
            const el = document.elementFromPoint(e.clientX, e.clientY);
            const onLight = el && lightSections.some(sel => el.closest(sel));
            glow.classList.toggle('on-light', !!onLight);
        });

        document.addEventListener('mouseleave', () => {
            glow.style.opacity = '0';
        });
    }
}

/**
 * 9. Certificates accordion on mobile
 */
function initCertsAccordion() {
    const toggle = document.getElementById('certs-toggle');
    const grid = document.querySelector('.certificates-grid');
    if (!toggle || !grid) return;

    toggle.addEventListener('click', () => {
        const isOpen = grid.classList.toggle('open');
        toggle.setAttribute('aria-expanded', String(isOpen));
        const label = toggle.querySelector('.certs-toggle-label');
        if (label) label.textContent = isOpen ? 'הסתר' : 'הצג רישיונות והסמכות';
    });
}

/**
 * 8. Interactive FAQ Accordion Click Handlers
 */
function initFaqAccordion() {
    const faqItems = document.querySelectorAll('.faq-item');
    
    faqItems.forEach(item => {
        const trigger = item.querySelector('.faq-trigger');
        const pane = item.querySelector('.faq-answer-pane');
        
        if (!trigger || !pane) return;
        
        trigger.addEventListener('click', () => {
            const isOpen = item.classList.contains('open');
            
            // Close all other FAQ items for a cleaner accordion feel (optional, but premium)
            faqItems.forEach(otherItem => {
                if (otherItem !== item && otherItem.classList.contains('open')) {
                    otherItem.classList.remove('open');
                    otherItem.querySelector('.faq-trigger').setAttribute('aria-expanded', 'false');
                    otherItem.querySelector('.faq-answer-pane').style.maxHeight = '0px';
                }
            });
            
            // Toggle the clicked FAQ item
            if (isOpen) {
                item.classList.remove('open');
                trigger.setAttribute('aria-expanded', 'false');
                pane.style.maxHeight = '0px';
            } else {
                item.classList.add('open');
                trigger.setAttribute('aria-expanded', 'true');
                pane.style.maxHeight = pane.scrollHeight + 'px';
            }
        });
    });
}


