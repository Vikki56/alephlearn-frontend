import { authFetch } from "./api.js";

async function loadQuestions() {
  const questions = await authFetch("/api/questions");

  const list = document.getElementById("questionsList");
  list.innerHTML = "";

  questions.forEach(q => {
    const item = document.createElement("div");
    item.className = "question-item";

    item.innerHTML = `
      <h3>${q.title}</h3>
      <p>${q.body}</p>
      <small>Asked by: ${q.askedBy}</small>

      <div style="margin-top:8px">
        <button class="claim-btn" onclick="claimQuestion(${q.id})">
          Claim
        </button>
      </div>
    `;

    list.appendChild(item);
  });
}

async function claimQuestion(questionId) {
  const res = await authFetch(`/api/rooms/claim/${questionId}`, {
    method: "POST"
  });

  if (res === "CLAIMED") {
    alert("Claimed! Join room within 15 minutes.");
  } else {
    alert(res);
  }
}

document.addEventListener("DOMContentLoaded", loadQuestions);