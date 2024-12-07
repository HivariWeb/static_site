<!-- <?php
session_start(); // Для работы с сессиями

if ($_SERVER["REQUEST_METHOD"] == "POST") {
    // Проверка CSRF токена
    if (!isset($_POST['csrf_token']) || $_POST['csrf_token'] !== $_SESSION['csrf_token']) {
        echo "Ошибка безопасности. Попробуйте снова.";
        exit;
    }

    // Фильтрация и валидация данных формы
    $name = filter_var(trim($_POST['name']), FILTER_SANITIZE_STRING);
    $email = filter_var(trim($_POST['email']), FILTER_VALIDATE_EMAIL);
    $date = $_POST['date'];
    $time = $_POST['time'];
    $comments = filter_var(trim($_POST['comments']), FILTER_SANITIZE_STRING);

    // Проверка корректности email
    if (!$email) {
        echo "Неправильный email. Попробуйте снова.";
        exit;
    }

    // Проверка на наличие обязательных данных
    if (empty($name) || empty($email) || empty($date) || empty($time)) {
        echo "Заполните все обязательные поля.";
        exit;
    }

    // Выводим данные на экран для проверки
    echo "<h3>Проверка формы</h3>";
    echo "Имя: " . htmlspecialchars($name) . "<br>";
    echo "Email: " . htmlspecialchars($email) . "<br>";
    echo "Дата: " . htmlspecialchars($date) . "<br>";
    echo "Время: " . htmlspecialchars($time) . "<br>";
    echo "Комментарии: " . nl2br(htmlspecialchars($comments)) . "<br>";

    // Если все данные корректны, продолжаем отправку письма
    $to = "max.web.tregubov@gmail.com"; // Укажи свой email
    $subject = "Новая запись на консультацию";
    
    // Формируем сообщение
    $message = "Имя: $name\nEmail: $email\nДата: $date\nВремя: $time\nКомментарии: $comments";

    $headers = "From: $email";

    // Попытка отправки письма
    if (mail($to, $subject, $message, $headers)) {
        echo "Ваша запись на консультацию отправлена!";
    } else {
        echo "Ошибка при отправке. Попробуйте еще раз.";
    }
}
?> -->
