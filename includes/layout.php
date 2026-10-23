<?php
declare(strict_types=1);

function asset_url(string $name): string
{
    static $versions;
    $versions ??= is_file(SITE_ROOT . '/config/assets.php') ? require SITE_ROOT . '/config/assets.php' : [];
    return '/' . $name . (isset($versions[$name]) ? '?v=' . rawurlencode($versions[$name]) : '');
}

function render_request_page(array $values = [], array $errors = [], string $message = ''): void
{
    $ready = true;
    $csrf = '';
    $ticket = '';
    $receipt = null;
    try {
        start_request_session();
        if (($_GET['done'] ?? '') === '1' && isset($_SESSION['receipt'])
            && ($_SESSION['receipt']['time'] ?? 0) > time() - 900) {
            $receipt = $_SESSION['receipt']['lead_id'];
        }
        if ($receipt === null) {
            $ticket = new_form_ticket();
            $csrf = $_SESSION['csrf'];
        }
    } catch (Throwable) {
        $ready = false;
        if (http_response_code() < 400) http_response_code(503);
    }
    $values = array_merge(['name' => '', 'contact_method' => 'telegram', 'contact' => '', 'service' => 'help'], $values);
    header('Content-Type: text/html; charset=UTF-8');
    ?>
<!doctype html>
<html lang="ru">
<head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex,follow"><meta name="theme-color" content="#8e175a">
    <title>Записаться на консультацию | Диана Березовская</title>
    <meta name="description" content="Оставьте контакт и выберите формат помощи по детскому сну. Диана ответит в рабочее время.">
    <link rel="canonical" href="https://www.dianaberezovskaya.online/request.php">
    <link rel="icon" href="/assets/day-and-night.png" type="image/png">
    <link rel="stylesheet" href="<?= h(asset_url('style.css')) ?>">
    <script src="<?= h(asset_url('site-config.js')) ?>" defer></script>
    <script src="<?= h(asset_url('script.js')) ?>" defer></script>
</head>
<body>
<?php readfile(__DIR__ . '/templates/header.html'); ?>
<main class="request-page" id="main"><div class="container">
    <div class="request-shell"><section class="request-card" aria-labelledby="request-title">
        <p class="eyebrow">Первый шаг — познакомиться</p>
        <h1 id="request-title">Обсудим вашу ситуацию</h1>
        <p class="request-intro">Оставьте удобный контакт и выберите формат. Если сомневаетесь — помогу определиться. Условия и дату работы согласуем лично.</p>
        <?php if (!$ready): ?>
            <div class="form-status form-status--error" role="status">Запись через форму временно недоступна. Напишите мне напрямую — контакты указаны ниже.</div>
        <?php elseif ($receipt !== null): ?>
            <div class="request-success" tabindex="-1"><h2>Заявка принята</h2><p>Номер обращения: <strong><?= h($receipt) ?></strong>.</p><p>Я свяжусь с вами выбранным способом в рабочее время: по будням с 09:00 до 17:00 по Москве.</p><a class="button button--outline" href="/">Вернуться на главную</a></div>
        <?php else: ?>
            <form id="request-form" action="/api/leads.php" method="post" accept-charset="UTF-8">
                <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
                <input type="hidden" name="ticket" value="<?= h($ticket) ?>">
                <div class="spam-field" aria-hidden="true"><label for="website">Оставьте это поле пустым</label><input id="website" name="website" type="text" tabindex="-1" autocomplete="off"></div>
                <div class="form-status form-status--error" id="form-status" role="alert" tabindex="-1"<?= $message === '' ? ' hidden' : '' ?>><?= h($message) ?></div>
                <div class="form-field"><label for="name">Как к вам обращаться</label><input id="name" name="name" autocomplete="given-name" maxlength="80" required value="<?= h($values['name']) ?>" aria-describedby="error-name"<?= isset($errors['name']) ? ' aria-invalid="true"' : '' ?>><p class="field-error" id="error-name"<?= isset($errors['name']) ? '' : ' hidden' ?>><?= h($errors['name'] ?? '') ?></p></div>
                <div class="form-field"><label for="contact_method">Где удобнее общаться</label><select id="contact_method" name="contact_method" required aria-describedby="error-contact_method"<?= isset($errors['contact_method']) ? ' aria-invalid="true"' : '' ?>>
                    <?php foreach (['telegram' => 'Telegram', 'whatsapp' => 'WhatsApp', 'email' => 'Электронная почта'] as $key => $label): ?>
                        <option value="<?= h($key) ?>"<?= $values['contact_method'] === $key ? ' selected' : '' ?>><?= h($label) ?></option>
                    <?php endforeach; ?>
                </select><p class="field-error" id="error-contact_method"<?= isset($errors['contact_method']) ? '' : ' hidden' ?>><?= h($errors['contact_method'] ?? '') ?></p></div>
                <div class="form-field"><label id="contact-label" for="contact">Контакт для связи</label><input id="contact" name="contact" type="text" maxlength="254" required value="<?= h($values['contact']) ?>" aria-describedby="contact-hint error-contact"<?= isset($errors['contact']) ? ' aria-invalid="true"' : '' ?>><p class="field-hint" id="contact-hint">Telegram: @username или номер; WhatsApp: номер с кодом страны; email: адрес почты.</p><p class="field-error" id="error-contact"<?= isset($errors['contact']) ? '' : ' hidden' ?>><?= h($errors['contact'] ?? '') ?></p></div>
                <div class="form-field"><label for="service">Какой формат интересует</label><select id="service" name="service" required aria-describedby="service-hint error-service"<?= isset($errors['service']) ? ' aria-invalid="true"' : '' ?>>
                    <?php foreach (['help', 'diary', 'regime', 'associations', 'support-3', 'support-5', 'extended'] as $key): $service = services()[$key]; ?>
                        <?php $priceLabel = $service['price_rub'] !== null ? ' — ' . number_format($service['price_rub'], 0, ',', ' ') . ' ₽' : ''; ?>
                        <option value="<?= h($key) ?>" data-full-label="<?= h($service['name'] . $priceLabel) ?>"<?= $values['service'] === $key ? ' selected' : '' ?>><?= h($service['short_name'] . $priceLabel) ?></option>
                    <?php endforeach; ?>
                </select><p class="field-hint" id="service-hint" aria-live="polite"><?php $selectedService = services()[$values['service']] ?? services()['help']; echo h($selectedService['name'] . ($selectedService['price_rub'] !== null ? ' — ' . number_format($selectedService['price_rub'], 0, ',', ' ') . ' ₽' : '')); ?></p><p class="field-error" id="error-service"<?= isset($errors['service']) ? '' : ' hidden' ?>><?= h($errors['service'] ?? '') ?></p></div>
                <label class="consent-label" for="consent"><input type="checkbox" id="consent" name="consent" value="1" required aria-describedby="error-consent"<?= isset($errors['consent']) ? ' aria-invalid="true"' : '' ?>><span>Даю <a href="/consent-request.html" target="_blank" rel="noopener">согласие на обработку персональных данных</a> для ответа на мою заявку.</span></label>
                <p class="field-error" id="error-consent"<?= isset($errors['consent']) ? '' : ' hidden' ?>><?= h($errors['consent'] ?? '') ?></p>
                <button class="button button--full" type="submit">Отправить заявку</button>
                <p class="form-note">Медицинские сведения и документы здесь не нужны. <a href="/privacy-policy.html" target="_blank" rel="noopener">Как обрабатываются данные</a>.</p>
                <p class="form-note">Отправка заявки не является оплатой или заключением договора. <a href="/offer.html" target="_blank" rel="noopener">Условия оказания услуг</a> согласуем до начала работы.</p>
            </form>
            <div class="request-success" id="request-success" tabindex="-1" role="status" hidden><h2>Заявка принята</h2><p>Номер обращения: <strong data-receipt></strong>.</p><p>Я свяжусь с вами выбранным способом в рабочее время: по будням с 09:00 до 17:00 по Москве.</p><a class="button button--outline" href="/">Вернуться на главную</a></div>
        <?php endif; ?>
    </section><aside class="request-aside"><h2>Можно написать напрямую</h2><p>Будни, 09:00–17:00 по Москве.</p><p><a href="https://t.me/diana_son_gv" target="_blank" rel="noopener noreferrer" data-contact-channel="telegram">Telegram: @diana_son_gv</a></p><p><a href="https://wa.me/79994652582" target="_blank" rel="noopener noreferrer" data-contact-channel="whatsapp">Написать в WhatsApp</a></p><p><a href="mailto:dianagulchenko@yandex.ru" data-contact-channel="email">dianagulchenko@yandex.ru</a></p><p><a href="/#services">Сравнить форматы и цены</a></p></aside></div>
</div></main>
<?php readfile(__DIR__ . '/templates/footer.html'); ?>
</body></html>
<?php
}
