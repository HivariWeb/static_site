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
