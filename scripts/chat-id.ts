// Affiche les conversations qui ont écrit au bot, pour remplir TELEGRAM_CHAT_ID.
// Envoyer d'abord /start au bot (ou l'ajouter à un groupe et y écrire un message).
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("TELEGRAM_BOT_TOKEN manquant dans .env");
  process.exit(1);
}

const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
const body = (await res.json()) as { ok: boolean; description?: string; result: any[] };
if (!body.ok) {
  console.error("Telegram a refusé la requête :", body.description);
  process.exit(1);
}

const chats = new Map<number, string>();
for (const u of body.result) {
  const chat = (u.message ?? u.my_chat_member ?? u.channel_post)?.chat;
  if (chat) chats.set(chat.id, chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(" ") || chat.username);
}

if (!chats.size) console.log("Aucun message reçu. Envoie /start au bot puis relance.");
for (const [id, name] of chats) console.log(`${id}\t${name}`);
