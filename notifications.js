let stompClient = null;

function connectNotifications() {
  const userId = localStorage.getItem("userId");
  console.log("[NOTIF] init, userId =", userId);
  if (!userId) return;

  const socket = new SockJS("http://localhost:8080/ws/notify");
  console.log("[NOTIF] SockJS created");

  stompClient = Stomp.over(socket);
  stompClient.debug = (msg) => console.log("[STOMP]", msg); 

  stompClient.connect(
    {},
    (frame) => {
      console.log("[NOTIF] connected:", frame);

      stompClient.subscribe(`/topic/notifications.user-${userId}`, (msg) => {
        const notif = JSON.parse(msg.body);
        handleIncomingNotification(notif);
      });
    },
    (error) => {
      console.error("[NOTIF] STOMP error:", error);
    }
  );
}

function handleIncomingNotification(notif) {
    try {
      // 1) Special handling for reply notifications
if (notif.type === "ANSWER_REPLIED") {
  if (window.location.pathname.endsWith("doubt-detail.html")) {
    const params = new URLSearchParams(window.location.search);
    const currentDoubtId = Number(params.get("id"));

    if (!Number.isNaN(currentDoubtId) && notif.doubtId === currentDoubtId) {
      const replyBtn = document.querySelector(
        `[data-role="reply-btn"][data-answer-id="${notif.answerId}"]`
      );

      if (replyBtn) {
        replyBtn.click();
      }

      if (typeof window.refreshRepliesFromNotification === "function") {
        window.refreshRepliesFromNotification(notif.answerId);
      }
    }
  }
}
  
      showNotificationToast(notif);
      incrementNotificationBadge();
    } catch (e) {
      console.error("[NOTIF] handleIncomingNotification error", e);
    }
  }

function showNotificationToast(notif) {
  const text = notif.message || "New notification";
  console.log("[NOTIF] toast:", text);
  alert(text);
}

function incrementNotificationBadge() {
  const badge = document.getElementById("notifBadge");
  if (!badge) return;
  const current = Number(badge.textContent || "0");
  badge.textContent = current + 1;
  badge.style.display = "inline-flex";
}

document.addEventListener("DOMContentLoaded", connectNotifications);