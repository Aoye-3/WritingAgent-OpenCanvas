const shell = document.querySelector(".app-shell");
const search = document.querySelector("#task-search");
const taskCards = [...document.querySelectorAll(".task-card")];
const contextBar = document.querySelector(".context-bar");
const contextToggle = document.querySelector("[data-toggle-context]");
const chatComposer = document.querySelector(".chat-composer");
const chatInput = document.querySelector(".chat-composer textarea");
const messageList = document.querySelector(".message-list");

function setView(view) {
  shell.dataset.view = view;
  document.querySelectorAll(".mode-switch").forEach((switcher) => {
    const isFree = view === "comparison";
    switcher.classList.toggle("is-free", isFree);
    switcher.setAttribute("aria-pressed", String(isFree));
    switcher.setAttribute(
      "aria-label",
      isFree ? "Switch to faceted task mode" : "Switch to free-text comparison mode"
    );
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll("[data-go-home]").forEach((button) => {
  button.addEventListener("click", () => setView("home"));
});

document.querySelectorAll("[data-open-workspace]").forEach((card) => {
  card.addEventListener("click", (event) => {
    if (event.target.closest("button")) return;
    setView("workspace");
  });

  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setView("workspace");
    }
  });
});

document.querySelectorAll("[data-open-comparison]").forEach((button) => {
  button.addEventListener("click", () => setView("comparison"));
});

document.querySelectorAll("[data-preview-prompt]").forEach((button) => {
  button.addEventListener("click", () => {
    contextBar.dataset.expanded = "true";
    contextToggle.textContent = "Collapse";
    document.querySelector(".prompt-card")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
});

document.querySelectorAll("[data-generate]").forEach((button) => {
  button.addEventListener("click", () => {
    const original = button.textContent;
    button.textContent = "Generating";
    button.disabled = true;
    setTimeout(() => {
      button.textContent = original;
      button.disabled = false;
    }, 850);
  });
});

if (contextToggle) {
  contextToggle.addEventListener("click", () => {
    const isExpanded = contextBar.dataset.expanded === "true";
    contextBar.dataset.expanded = String(!isExpanded);
    contextToggle.textContent = isExpanded ? "Expand" : "Collapse";
  });
}

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && contextBar?.dataset.expanded === "true") {
    contextBar.dataset.expanded = "false";
    contextToggle.textContent = "Expand";
    contextToggle.focus();
  }
});

if (search) {
  search.addEventListener("input", () => {
    const query = search.value.trim().toLowerCase();
    taskCards.forEach((card) => {
      const text = card.textContent.toLowerCase();
      card.hidden = query.length > 0 && !text.includes(query);
    });
  });
}

function appendMessage(role, text) {
  const message = document.createElement("article");
  message.className = `message message-${role}`;

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = role === "user" ? "U" : "F";

  const bubble = document.createElement("div");
  bubble.className = "message-bubble";

  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  bubble.append(paragraph);
  message.append(avatar, bubble);
  messageList.append(message);
  message.scrollIntoView({ behavior: "smooth", block: "end" });
}

function resizeChatInput() {
  if (!chatInput) return;
  chatInput.style.height = "auto";
  chatInput.style.height = `${Math.min(chatInput.scrollHeight, 180)}px`;
}

if (chatInput) {
  chatInput.addEventListener("input", resizeChatInput);
  chatInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      chatComposer?.requestSubmit();
    }
  });
  resizeChatInput();
}

if (chatComposer) {
  chatComposer.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;

    appendMessage("user", text);
    chatInput.value = "";
    resizeChatInput();

    window.setTimeout(() => {
      appendMessage(
        "assistant",
        "Sure. Climate change is like the planet slowly turning up its thermostat. For example, a place that used to have mild summers might now have more very hot days, which can affect schools, sports, plants, and everyday life."
      );
    }, 450);
  });
}
