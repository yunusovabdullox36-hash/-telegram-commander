import os
import subprocess
import tempfile
import time
import json
import google.generativeai as genai
import telebot
from PIL import ImageGrab
from telebot import types

# Proxies clean up if needed
for proxy_var in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
    if os.environ.get(proxy_var) == "http://127.0.0.1:9":
        os.environ.pop(proxy_var, None)

TELEGRAM_TOKEN = os.environ.get("TELEGRAM_TOKEN") or "8859542275:AAEBetf9Zpro5oqHK7JQix_ZQOmtB-qY80Y"
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY") or "AIzaSyAPZ49Yo2SB4FR_AnuUSEQbbfHUdFHSUQY"
PROXY = os.environ.get("TELEGRAM_PROXY")
ALLOWED_CHAT_ID = os.environ.get("TELEGRAM_ALLOWED_CHAT_ID") or "7254093696"
GEMINI_MODEL = os.environ.get("GEMINI_MODEL") or "models/gemini-2.5-flash"

if not TELEGRAM_TOKEN:
    raise RuntimeError("TELEGRAM_TOKEN env yoki qiymat kerak.")
if not GEMINI_API_KEY:
    raise RuntimeError("GEMINI_API_KEY env yoki qiymat kerak.")

if PROXY:
    from telebot import apihelper
    apihelper.proxy = {"http": PROXY, "https": PROXY}
else:
    from telebot import apihelper
    apihelper.proxy = None
    try:
        apihelper._get_req_session().trust_env = False
    except Exception:
        pass

# Configure Gemini
genai.configure(api_key=GEMINI_API_KEY)

# Define local tools for Gemini
def run_command(command: str) -> str:
    """Executes a command-line prompt in PowerShell on the local Windows system and returns its stdout + stderr output."""
    try:
        result = subprocess.run(["powershell.exe", "-Command", command], capture_output=True, text=True, timeout=120)
        output = result.stdout + result.stderr
        return output if output.strip() else "Command executed successfully with no output."
    except Exception as e:
        return f"Error executing command: {str(e)}"

def read_file(filepath: str) -> str:
    """Reads the content of a file from the local file system and returns it as a string."""
    try:
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            return f.read()
    except Exception as e:
        return f"Error reading file: {str(e)}"

def write_file(filepath: str, content: str) -> str:
    """Writes content to a file, overwriting the file if it already exists."""
    try:
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        return f"File successfully written to {filepath}"
    except Exception as e:
        return f"Error writing file: {str(e)}"

def list_dir(directory: str) -> str:
    """Lists the files and folders inside the specified directory."""
    try:
        items = os.listdir(directory)
        return json.dumps(items, indent=2)
    except Exception as e:
        return f"Error listing directory: {str(e)}"

def take_screenshot() -> str:
    """Takes a screenshot of the user's desktop screen and sends it directly to the Telegram chat. Returns a status message."""
    try:
        screenshot_path = os.path.join(tempfile.gettempdir(), "telegram_bridge_screenshot.png")
        screenshot = ImageGrab.grab()
        screenshot.save(screenshot_path)
        with open(screenshot_path, "rb") as photo:
            bot.send_photo(trusted_chat_id, photo)
        os.remove(screenshot_path)
        return "Screenshot captured and sent to the Telegram chat successfully."
    except Exception as e:
        return f"Error capturing screenshot: {str(e)}"

SYSTEM_INSTRUCTION = """
Sen local Windows kompyuterda ishlaydigan va foydalanuvchiga Telegram bot orqali xizmat qiladigan AI yordamchisan.
Sening isming Jarvis, foydalanuvchini Shotman deb chaqir (murojaat qilganda).

Senda mahalliy tizim bilan ishlash uchun quyidagi toolslar bor:
- run_command: Windows PowerShell buyruqlarini ishga tushirish (masalan loyihalarni yurgizish, git, npm, vs).
- read_file: Fayl kontentini o'qish (kodlar, Obsidian note'lar, vs).
- write_file: Fayl yozish yoki tahrirlash.
- list_dir: Papkadagi fayllar ro'yxatini ko'rish.
- take_screenshot: Ekran rasmini olib yuborish.

Foydalanuvchining loyihalari va Obsidian miya tizimi:
- Barcha loyihalar va Obsidian vault `C:\\Users\\user` da joylashgan.
- Obsidian Vault: `C:\\Users\\user\\OneDrive\\Документы\\Obsidian Vault`
- Markaziy boshqaruv fayli: `C:\\Users\\user\\OneDrive\\Документы\\Obsidian Vault\\_Miya\\MAIN.md`
- Loyihalar ro'yxati va holati: `C:\\Users\\user\\OneDrive\\Документы\\Obsidian Vault\\_Miya\\AGENTS_STATUS.md`
- Boshqa loyihalar `C:\\Users\\user\\Projects` yoki `C:\\Users\\user` dagi papkalarda joylashgan (hospital-system, cardlab, vitacare, agent-town, vs).

Ishlash uslubi:
- Foydalanuvchi buyruq berganida (masalan: "obsidian room holatini tekshir", "hospital-system loyihasini start qil", "skrinshot tashla"), tegishli toolni chaqir.
- Foydalanuvchi senga /cmd yoki shunga o'xshash maxsus buyruqlarni yozishi shart emas. Har qanday matnni tabiiy til deb qabul qilib, kerakli amalni mustaqil bajar.
- Har doim qisqa, aniq va professional javob ber. Ortiqcha gaplar va ogohlantirishlar yozma.
"""

# Initialize Gemini Model with Tools and System Instruction
model = genai.GenerativeModel(
    model_name=GEMINI_MODEL,
    tools=[run_command, read_file, write_file, list_dir, take_screenshot],
    system_instruction=SYSTEM_INSTRUCTION
)

chat = model.start_chat(enable_automatic_function_calling=True)
bot = telebot.TeleBot(TELEGRAM_TOKEN)
trusted_chat_id = int(ALLOWED_CHAT_ID) if ALLOWED_CHAT_ID else None

def health_report():
    report = {
        "telegram_token": bool(TELEGRAM_TOKEN),
        "gemini_api_key": bool(GEMINI_API_KEY),
        "proxy": bool(PROXY),
        "allowed_chat_id": trusted_chat_id,
        "gemini_model": GEMINI_MODEL,
    }
    try:
        me = bot.get_me()
        report["telegram_api"] = f"ok:{me.username or me.first_name or me.id}"
    except Exception as exc:
        report["telegram_api"] = f"error:{exc}"
    try:
        models = genai.list_models()
        report["gemini_api"] = f"ok:{len(list(models))}"
    except Exception as exc:
        report["gemini_api"] = f"error:{exc}"
    return report

def is_allowed(message_or_call):
    global trusted_chat_id
    chat_id = message_or_call.message.chat.id if hasattr(message_or_call, "message") else message_or_call.chat.id
    if trusted_chat_id is None:
        trusted_chat_id = chat_id
        print(f"Allowed chat locked to: {trusted_chat_id}")
        return True
    return chat_id == trusted_chat_id

def deny_if_needed(message_or_call):
    if is_allowed(message_or_call):
        return False
    if hasattr(message_or_call, "message"):
        bot.answer_callback_query(message_or_call.id, "Ruxsat yo'q.")
    else:
        bot.reply_to(message_or_call, "Bu bot faqat egasi uchun.")
    return True

def send_long(chat_id, text):
    if len(text) <= 3900:
        try:
            bot.send_message(chat_id, f"```\n{text}\n```", parse_mode="Markdown")
        except Exception:
            bot.send_message(chat_id, text)
        return

    with tempfile.NamedTemporaryFile("w", delete=False, suffix=".txt", encoding="utf-8") as file:
        file.write(text)
        path = file.name

    try:
        with open(path, "rb") as file:
            bot.send_document(chat_id, file, visible_file_name="output.txt")
    finally:
        os.remove(path)

@bot.message_handler(commands=["start", "help"])
def send_welcome(message):
    if deny_if_needed(message):
        return
    bot.reply_to(
        message,
        "Ha, Shotman. Jarvis tizimi ulandi va tayyor.\n\n"
        "Men orqali kompyuterni va Obsidian xotirani to'liq boshqarishingiz mumkin.\n"
        "Nima qilish kerakligini oddiy matn orqali yozing (masalan: 'skrinshot ol', 'obsidian statusni o'qi', 'dir buyrug'ini ishlat').\n\n"
        f"Gemini model: {GEMINI_MODEL}\n"
        "Health check: /health\n"
        "Manual screenshot: /screenshot"
    )

@bot.message_handler(commands=["health"])
def send_health(message):
    if deny_if_needed(message):
        return
    report = health_report()
    lines = [f"{key}: {value}" for key, value in report.items()]
    bot.reply_to(message, "Healthcheck:\n" + "\n".join(lines))

@bot.message_handler(commands=["screenshot"])
def manual_screenshot(message):
    if deny_if_needed(message):
        return
    status = take_screenshot()
    bot.reply_to(message, status)

@bot.message_handler(func=lambda message: True)
def handle_chat(message):
    if deny_if_needed(message):
        return

    for attempt in range(3):
        try:
            bot.send_chat_action(message.chat.id, "typing")
            response = chat.send_message(message.text)
            text_response = response.text or "Javob bo'sh keldi."
            
            if len(text_response) > 3900:
                send_long(message.chat.id, text_response)
            else:
                try:
                    bot.reply_to(message, text_response, parse_mode="Markdown")
                except Exception:
                    bot.reply_to(message, text_response)
            return
        except Exception as exc:
            if ("429" in str(exc) or "timeout" in str(exc).lower()) and attempt < 2:
                time.sleep(5)
                continue
            bot.reply_to(message, f"Gemini xatoligi: {exc}")
            return

if __name__ == "__main__":
    print(f"Bot ishga tushmoqda. Gemini model: {GEMINI_MODEL}")
    print("Healthcheck:")
    for key, value in health_report().items():
        print(f"  {key}: {value}")
    bot.infinity_polling(skip_pending=True, timeout=30, long_polling_timeout=30)
