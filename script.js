// Обертка для выполнения кода после загрузки DOM
document.addEventListener('DOMContentLoaded', () => {

        // Инициализация модального окна
        const modal = document.getElementById('myModal');
        const modalImg = document.getElementById('img01');
        const captionText = document.getElementById('caption');
        let imageIndex = 0;
    
        const images = document.querySelectorAll('.myImg');
        if (modal && modalImg && images.length) {
            images.forEach((img, index) => {
                img.addEventListener('click', function() {
                    modal.style.display = 'block';
                    modalImg.src = this.src;
                    captionText.innerHTML = this.alt;
                    imageIndex = index;
                });
            });
            
            const close = document.querySelector('.close');
            if (close) {
                close.onclick = () => {
                    modal.style.display = 'none';
                };
            }
    
            const next = document.querySelector('.next');
            if (next) {
                next.onclick = () => {
                    imageIndex = (imageIndex + 1) % images.length;
                    modalImg.src = images[imageIndex].src;
                    captionText.innerHTML = images[imageIndex].alt;
                };
            }
    
            const prev = document.querySelector('.prev');
            if (prev) {
                prev.onclick = () => {
                    imageIndex = (imageIndex - 1 + images.length) % images.length;
                    modalImg.src = images[imageIndex].src;
                    captionText.innerHTML = images[imageIndex].alt;
                };
            }
    
            // Добавляем обработчик для закрытия модального окна при клике вне модального изображения
            modal.addEventListener('click', (e) => {
                if (e.target === modal) { // Проверяем, что клик был именно по модальному контейнеру
                    modal.style.display = 'none';
                }
            });
        }

    // Функция для раскрытия элементов при прокрутке
    function revealOnScroll() {
        const fadeInElements = document.querySelectorAll('.fade-in');
        const screenPosition = window.innerHeight * 0.8; // 80% высоты экрана

        fadeInElements.forEach(element => {
            const elementPosition = element.getBoundingClientRect().top;

            if (elementPosition < screenPosition && !element.classList.contains('show')) {
                element.classList.add('show');
            }
        });
    }

    // Функция для управления гамбургерами
    function burgerMenu(selector) {
        const menu = document.querySelector(selector);
        const button = menu.querySelector('.hamburger-menu_button, .hamburger-menu_lines');
        const links = menu.querySelectorAll('.hamburger-menu_link');
        const overlay = menu.querySelector('.hamburger-menu_overlay');
        
        button.addEventListener('click', toggleMenu);
        links.forEach(link => link.addEventListener('click', toggleMenu));
        overlay.addEventListener('click', toggleMenu);
        
        function toggleMenu() {
            menu.classList.toggle('hamburger-menu_active');
            document.body.style.overflow = menu.classList.contains('hamburger-menu_active') ? 'hidden' : 'visible';
        }
    }

    // Инициализация меню
    burgerMenu('.hamburger-menu');
    
    // Обработка уведомления о куки
    if (!localStorage.getItem('cookiesAccepted')) {
        const cookieNotice = document.getElementById('cookie-notice');
        if (cookieNotice) {
            cookieNotice.style.display = 'block';
        }

        const acceptCookiesBtn = document.getElementById('accept-cookies');
        if (acceptCookiesBtn) {
            acceptCookiesBtn.addEventListener('click', () => {
                localStorage.setItem('cookiesAccepted', 'true');
                cookieNotice.style.display = 'none';
            });
        }
    }

    // Первоначальное отображение и обновление при скролле
    revealOnScroll();
    window.addEventListener('load', revealOnScroll);
    window.addEventListener('scroll', revealOnScroll);
});


// Активация кнопок "Записаться" только после согласия с офертой и политикой
(function () {
    function initLegalGatedLinks() {
        const consentBlocks = document.querySelectorAll('.cta-consent-block');

        consentBlocks.forEach(function (block) {
            const checkbox = block.querySelector('.legal-consent-checkbox');
            const link = block.querySelector('.legal-gated-link');

            if (!checkbox || !link) {
                return;
            }

            const realHref = link.getAttribute('data-href');

            function updateState() {
                if (checkbox.checked) {
                    link.classList.remove('is-disabled');
                    link.setAttribute('aria-disabled', 'false');
                    if (realHref) {
                        link.setAttribute('href', realHref);
                    }
                } else {
                    link.classList.add('is-disabled');
                    link.setAttribute('aria-disabled', 'true');
                    link.setAttribute('href', '#');
                }
            }

            link.addEventListener('click', function (event) {
                if (!checkbox.checked) {
                    event.preventDefault();
                }
            });

            checkbox.addEventListener('change', updateState);
            updateState();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initLegalGatedLinks);
    } else {
        initLegalGatedLinks();
    }
})();
