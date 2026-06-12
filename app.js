/* ==========================================================================
   LABVANCED STUDIO – APPLICATION ENGINE (HTML, CSS, JS THUẦN)
   ========================================================================== */

// ===== 1. CORE APPLICATION STATE =====
let state = {
  projectName: "Thí nghiệm Stroop Màu sắc - Từ ngữ",
  activeTab: "editor",
  slides: [],
  selectedSlideId: null,
  selectedElementId: null,
  trialsTable: [],
  variables: [], // e.g. ["word", "color", "congruent", "correct_key"]
  settings: {
    randomizeTrials: false,
    autoSyncGSheet: false,
    gsheetUrl: ""
  },
  results: [] // Participant run records
};

// State for Canvas interaction
let canvasDragState = {
  isDragging: false,
  isResizing: false,
  resizeDirection: null, // "tl", "tr", "bl", "br"
  startX: 0,
  startY: 0,
  startLeft: 0,
  startTop: 0,
  startWidth: 0,
  startHeight: 0,
  elemId: null
};

// Playback Engine state
let playbackState = {
  isActive: false,
  participant: "Participant_001",
  trialsQueue: [], // Shuffled/sorted rows from trialsTable
  currentTrialIndex: -1,
  currentSlideIndex: 0,
  currentSlideId: null,
  slideStartTime: 0,
  trialStartTime: 0,
  trialResponses: [], // Responses logged in the current trial
  runTrialsLog: [], // Detailed trial results for current run
  activeTimerId: null, // For slide timeouts
  playerKeysPressed: {}
};

// Constants for local storage
const LOCAL_STORAGE_KEY = "labvanced_studio_state_v4";

// Global flag for participant only mode
let isParticipantOnly = false;

// ===== 2. INITIALIZATION & STORAGE =====
document.addEventListener("DOMContentLoaded", () => {
  loadStateFromLocalStorage();
  
  // Attach key listeners for the player & builder delete action
  document.addEventListener("keydown", handleGlobalKeyDown);
  
  // Set up mouse events for dragging/resizing outside target to prevent lockups
  document.addEventListener("mousemove", handleCanvasMouseMove);
  document.addEventListener("mouseup", handleCanvasMouseUp);
  
  // Check if role is participant/user
  const urlParams = new URLSearchParams(window.location.search);
  isParticipantOnly = urlParams.has("participant") || 
                       urlParams.get("role") === "user" || 
                       urlParams.get("role") === "participant" || 
                       window.location.hash === "#participant";
  
  // Load configuration and results from server, then boot the app
  Promise.all([
    loadProjectFromServer(),
    loadResultsFromServer()
  ]).finally(() => {
    // Initialize default project if empty
    if (state.slides.length === 0) {
      loadTemplate("type1_1");
    } else {
      initUI();
    }
    
    if (isParticipantOnly) {
      // Hide administrative editor layout completely
      document.body.classList.add("participant-only-mode");
      
      // Add styles to hide app-wrapper and adjust player actions
      const style = document.createElement("style");
      style.innerHTML = `
        body.participant-only-mode .app-wrapper {
          display: none !important;
        }
        body.participant-only-mode .player-overlay {
          background-color: #0b0f19 !important;
        }
      `;
      document.head.appendChild(style);
      
      // Open player immediately
      setTimeout(() => {
        startExperiment();
        
        // Hide the cancel button in participant mode
        const cancelBtn = document.querySelector(".player-setup-actions .btn-secondary");
        if (cancelBtn) {
          cancelBtn.style.display = "none";
        }
        
        // Update the complete box button text and action
        const submitBtn = document.querySelector("#player-complete-box .player-setup-actions .btn-primary");
        if (submitBtn) {
          submitBtn.textContent = "Hoàn thành & Bắt đầu lượt mới";
          submitBtn.setAttribute("onclick", "location.reload()");
        }
      }, 150);
    }
  });
});

function openParticipantLink() {
  const userUrl = window.location.origin + window.location.pathname + "?role=participant";
  
  // Try to copy to clipboard
  navigator.clipboard.writeText(userUrl).then(() => {
    showNotification("Đã sao chép link người tham gia vào bộ nhớ tạm!");
    window.open(userUrl, "_blank");
  }).catch(() => {
    // Fallback if clipboard fails
    window.open(userUrl, "_blank");
  });
}

function handlePlayerGroupChange(val) {
  if (val === "current") return;
  loadTemplate(val);
  document.getElementById("player-setup-project-name").textContent = state.projectName;
  showNotification(`Đã đổi sang bài test: ${state.projectName}`);
}

function initUI() {
  // Sync HTML inputs with loaded state
  document.getElementById("project-name").value = state.projectName;
  document.getElementById("gsheet-url").value = state.settings.gsheetUrl || "";
  document.getElementById("setting-randomize-trials").checked = !!state.settings.randomizeTrials;
  document.getElementById("setting-auto-sync").checked = !!state.settings.autoSyncGSheet;
  
  updateSyncStatusIndicator();
  renderSlidesList();
  renderTrialsTable();
  renderRunsHistory();
  renderResultsTable();
  drawAnalyticsChart();
  
  // Open default slide
  if (state.slides.length > 0) {
    selectSlide(state.slides[0].id);
  }
  
  switchTab(state.activeTab);
}

let serverSaveTimeout = null;

function saveStateToLocalStorage() {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(state));
    saveStateToServer();
  } catch (e) {
    console.error("Lưu trữ LocalStorage thất bại:", e);
  }
}

function saveStateToLocalStorageOnly() {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error("Lưu trữ LocalStorage thất bại:", e);
  }
}

function saveStateToServer() {
  if (serverSaveTimeout) clearTimeout(serverSaveTimeout);
  serverSaveTimeout = setTimeout(() => {
    // Clone state and strip results to keep project file clean
    const projectConfig = {
      projectName: state.projectName,
      slides: state.slides,
      variables: state.variables,
      trialsTable: state.trialsTable,
      settings: state.settings
    };
    
    fetch('/api/project', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(projectConfig)
    })
    .then(r => r.json())
    .then(data => {
      console.log('Project config synced to server');
    })
    .catch(err => {
      console.warn('Could not sync project config to server:', err);
    });
  }, 1000);
}

function loadProjectFromServer() {
  return fetch('/api/project')
    .then(r => {
      if (!r.ok) throw new Error('No project config on server');
      return r.json();
    })
    .then(projectConfig => {
      if (projectConfig && Array.isArray(projectConfig.slides)) {
        state.projectName = projectConfig.projectName || state.projectName;
        state.slides = projectConfig.slides;
        state.variables = projectConfig.variables || [];
        state.trialsTable = projectConfig.trialsTable || [];
        state.settings = projectConfig.settings || state.settings;
        console.log('Project config loaded from server');
      }
    })
    .catch(err => {
      console.warn('Could not load project config from server, using local storage:', err);
    });
}

function loadResultsFromServer() {
  return fetch('/api/results')
    .then(r => r.json())
    .then(serverResults => {
      if (Array.isArray(serverResults)) {
        const resultsMap = new Map();
        
        // Load local ones first
        state.results.forEach(r => {
          if (r && r.id) resultsMap.set(r.id, r);
        });
        
        // Override with server ones (server is source of truth)
        serverResults.forEach(r => {
          if (r && r.id) resultsMap.set(r.id, r);
        });
        
        state.results = Array.from(resultsMap.values());
        
        // Sort by ID descending (which corresponds to timestamp since ID starts with run_TIMESTAMP)
        state.results.sort((a, b) => {
          const idA = a.id || "";
          const idB = b.id || "";
          return idB.localeCompare(idA);
        });
        
        saveStateToLocalStorageOnly(); // save to local storage but don't loop back to server
        if (typeof renderRunsHistory === 'function') renderRunsHistory();
        if (typeof renderResultsTable === 'function') renderResultsTable();
      }
      return true;
    })
    .catch(err => {
      console.warn('Could not load results from server:', err);
      return false;
    });
}

function loadStateFromLocalStorage() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.slides)) {
        state = parsed;
      }
    }
  } catch (e) {
    console.warn("Không tìm thấy dữ liệu cũ hoặc dữ liệu bị lỗi, tạo mới.");
  }
}

// ===== 3. SYSTEM NOTIFICATIONS =====
function showNotification(message, type = "success") {
  const toast = document.getElementById("toast-notification");
  toast.textContent = message;
  toast.className = `toast-notification show`;
  
  if (type === "success") {
    toast.style.borderColor = "var(--accent-success)";
    toast.style.boxShadow = "0 4px 15px rgba(0,0,0,0.5), 0 0 10px rgba(16, 185, 129, 0.4)";
  } else if (type === "danger") {
    toast.style.borderColor = "var(--accent-danger)";
    toast.style.boxShadow = "0 4px 15px rgba(0,0,0,0.5), 0 0 10px rgba(239, 68, 68, 0.4)";
  } else {
    toast.style.borderColor = "var(--primary-accent-light)";
  }
  
  setTimeout(() => {
    toast.classList.remove("show");
  }, 2800);
}

// ===== 4. PROJECT TEMPLATES DEFINITIONS =====
function loadTemplate(templateType) {
  state.slides = [];
  state.selectedSlideId = null;
  state.selectedElementId = null;
  state.trialsTable = [];
  state.variables = [];
  
  if (templateType === "type1_1") {
    state.projectName = "Nhóm 1: Tập Trung Cao (Multi-Task)";
    state.variables = [
      "sentence", "correct_sentence",
      "math_eq", "math_ans",
      "english_q", "english_opts", "english_ans",
      "dual_english", "dual_english_opts", "dual_english_ans",
      "dual_math", "dual_math_ans"
    ];
    
    const slideInstructions = {
      id: "slide_instructions",
      name: "Hướng dẫn",
      elements: [
        {
          id: "txt_title",
          type: "text",
          left: 50, top: 30, width: 700, height: 50,
          text: "NHÓM 1: BÀI TEST TẬP TRUNG CAO (TYPE 1.1)",
          fontSize: 26, color: "#007a48",
          backgroundColor: "transparent", borderRadius: 0, borderColor: "transparent", borderWidth: 0,
          trigger: { type: "none" }
        },
        {
          id: "txt_body",
          type: "text",
          left: 50, top: 100, width: 700, height: 290,
          text: "Bài kiểm tra này gồm 4 nhiệm vụ kết hợp đo lường sự tập trung và phản xạ:\n\n1. Ghi nhớ câu hiển thị trong 15 giây, sau đó tự gõ lại câu trả lời.\n2. Giải nhanh phép tính toán học hiển thị trên màn hình.\n3. Trả lời câu hỏi trắc nghiệm ngữ pháp tiếng Anh.\n4. Nhiệm vụ kép (Dual-Task): Bạn sẽ có 20 giây để quan sát và ghi nhớ đồng thời 1 từ tiếng Anh bị thiếu và 1 phép tính nhẩm. Sau khi biến mất, bạn phải chọn từ tiếng Anh đúng và gõ đáp số phép tính nhẩm.\n\nNhấn nút bên dưới khi bạn đã sẵn sàng.",
          fontSize: 14, color: "#cbd5e1",
          backgroundColor: "rgba(255,255,255,0.02)", borderRadius: 8, borderColor: "rgba(255,255,255,0.05)", borderWidth: 1,
          trigger: { type: "none" }
        },
        {
          id: "btn_start",
          type: "button",
          left: 300, top: 415, width: 200, height: 50,
          text: "Bắt đầu bài Test",
          fontSize: 16, color: "#ffffff",
          backgroundColor: "linear-gradient(135deg, #007a48, #10b981)", borderRadius: 8, borderColor: "rgba(255,255,255,0.1)", borderWidth: 1,
          trigger: {
            type: "click",
            action: "next"
          }
        }
      ]
    };

    const slideFixation = {
      id: "slide_fixation",
      name: "Tâm Cố Định",
      elements: [
        {
          id: "fixation_cross",
          type: "fixation",
          left: 370, top: 220, width: 60, height: 60,
          text: "+",
          fontSize: 44, color: "#007a48",
          backgroundColor: "transparent", borderRadius: 0, borderColor: "transparent", borderWidth: 0,
          trigger: {
            type: "timeout",
            action: "next",
            duration: 1000
          }
        }
      ]
    };

    const slideTask1Memo = {
      id: "slide_t1_memo",
      name: "Task 1: Ghi nhớ câu",
      elements: [
        {
          id: "t1_title",
          type: "text",
          left: 100, top: 80, width: 600, height: 50,
          text: "Hãy ghi nhớ câu dưới đây (15 giây):",
          fontSize: 18, color: "#007a48",
          backgroundColor: "transparent", borderRadius: 0, borderColor: "transparent", borderWidth: 0,
          trigger: { type: "none" }
        },
        {
          id: "t1_memo_text",
          type: "text",
          left: 100, top: 160, width: 600, height: 180,
          text: "{{sentence}}",
          fontSize: 28, color: "#ffffff",
          backgroundColor: "rgba(255,255,255,0.01)", borderRadius: 12, borderColor: "rgba(255,255,255,0.05)", borderWidth: 1,
          trigger: {
            type: "timeout",
            action: "next",
            duration: 15000
          }
        }
      ]
    };

    const slideTask1Input = {
      id: "slide_t1_input",
      name: "Task 1: Nhập kết quả",
      elements: [
        {
          id: "t1_prompt",
          type: "text",
          left: 100, top: 100, width: 600, height: 50,
          text: "Hãy gõ lại chính xác câu bạn vừa ghi nhớ:",
          fontSize: 18, color: "#ffffff",
          backgroundColor: "transparent", borderRadius: 0, borderColor: "transparent", borderWidth: 0,
          trigger: { type: "none" }
        },
        {
          id: "t1_input_box",
          type: "input",
          left: 100, top: 180, width: 600, height: 80,
          backgroundColor: "rgba(0,0,0,0.3)", borderRadius: 8, borderColor: "rgba(255,255,255,0.15)", borderWidth: 1,
          trigger: { type: "none" }
        },
        {
          id: "t1_submit",
          type: "button",
          left: 300, top: 320, width: 200, height: 50,
          text: "Xác nhận",
          fontSize: 16, color: "#ffffff",
          backgroundColor: "#007a48", borderRadius: 8, borderColor: "transparent", borderWidth: 0,
          trigger: {
            type: "click",
            action: "next",
            correctKey: "{{correct_sentence}}"
          }
        }
      ]
    };

    const slideTask2Math = {
      id: "slide_t2_math",
      name: "Task 2: Tính nhẩm",
      elements: [
        {
          id: "t2_prompt",
          type: "text",
          left: 100, top: 60, width: 600, height: 50,
          text: "Tính nhanh giá trị của phép toán sau:",
          fontSize: 18, color: "#ffffff",
          backgroundColor: "transparent", borderRadius: 0, borderColor: "transparent", borderWidth: 0,
          trigger: { type: "none" }
        },
        {
          id: "t2_equation",
          type: "text",
          left: 200, top: 130, width: 400, height: 90,
          text: "{{math_eq}}",
          fontSize: 36, color: "#007a48",
          backgroundColor: "transparent", borderRadius: 0, borderColor: "transparent", borderWidth: 0,
          trigger: { type: "none" }
        },
        {
          id: "t2_input_box",
          type: "input",
          left: 250, top: 240, width: 300, height: 50,
          backgroundColor: "rgba(0,0,0,0.3)", borderRadius: 6, borderColor: "rgba(255,255,255,0.15)", borderWidth: 1,
          trigger: { type: "none" }
        },
        {
          id: "t2_submit",
          type: "button",
          left: 300, top: 330, width: 200, height: 50,
          text: "Xác nhận kết quả",
          fontSize: 16, color: "#ffffff",
          backgroundColor: "#007a48", borderRadius: 8, borderColor: "transparent", borderWidth: 0,
          trigger: {
            type: "click",
            action: "next",
            correctKey: "{{math_ans}}"
          }
        }
      ]
    };

    const slideTask3English = {
      id: "slide_t3_english",
      name: "Task 3: Trắc nghiệm Tiếng Anh",
      elements: [
        {
          id: "t3_prompt",
          type: "text",
          left: 100, top: 50, width: 600, height: 60,
          text: "Chọn đáp án đúng điền vào chỗ trống:",
          fontSize: 18, color: "#ffffff",
          backgroundColor: "transparent", borderRadius: 0, borderColor: "transparent", borderWidth: 0,
          trigger: { type: "none" }
        },
        {
          id: "t3_question",
          type: "text",
          left: 100, top: 120, width: 600, height: 120,
          text: "{{english_q}}",
          fontSize: 22, color: "#007a48",
          backgroundColor: "transparent", borderRadius: 0, borderColor: "transparent", borderWidth: 0,
          trigger: { type: "none" }
        },
        {
          id: "t3_choices",
          type: "choice",
          left: 150, top: 260, width: 500, height: 160,
          text: "Hãy bấm chọn đáp án:",
          options: "{{english_opts}}",
          fontSize: 14, color: "#10b981",
          backgroundColor: "rgba(255,255,255,0.01)", borderRadius: 8, borderColor: "rgba(255,255,255,0.05)", borderWidth: 1,
          trigger: {
            type: "keypress",
            action: "next",
            correctKey: "{{english_ans}}"
          }
        }
      ]
    };

    const slideTask4DualMemo = {
      id: "slide_t4_dual_memo",
      name: "Task 4 & 5: Ghi nhớ Dual-Task",
      elements: [
        {
          id: "t4_memo_prompt",
          type: "text",
          left: 100, top: 50, width: 600, height: 50,
          text: "Hãy ghi nhớ cả 2 thông tin sau (20 giây):",
          fontSize: 18, color: "#ffffff",
          backgroundColor: "transparent", borderRadius: 0, borderColor: "transparent", borderWidth: 0,
          trigger: { type: "none" }
        },
        {
          id: "t4_memo_english",
          type: "text",
          left: 100, top: 120, width: 600, height: 110,
          text: "[Tiếng Anh]: {{dual_english}}",
          fontSize: 22, color: "#007a48",
          backgroundColor: "rgba(0,122,72,0.03)", borderRadius: 8, borderColor: "rgba(0,122,72,0.1)", borderWidth: 1,
          trigger: { type: "none" }
        },
        {
          id: "t4_memo_math",
          type: "text",
          left: 100, top: 250, width: 600, height: 110,
          text: "[Phép toán]: {{dual_math}}",
          fontSize: 24, color: "#10b981",
          backgroundColor: "rgba(16,185,129,0.03)", borderRadius: 8, borderColor: "rgba(16,185,129,0.1)", borderWidth: 1,
          trigger: {
            type: "timeout",
            action: "next",
            duration: 20000
          }
        }
      ]
    };

    const slideTask4DualResponse = {
      id: "slide_t4_dual_resp",
      name: "Task 4 & 5: Điền đáp án",
      elements: [
        {
          id: "t4_resp_prompt",
          type: "text",
          left: 100, top: 30, width: 600, height: 40,
          text: "Chọn đáp án tiếng Anh và nhập kết quả phép tính:",
          fontSize: 16, color: "#ffffff",
          backgroundColor: "transparent", borderRadius: 0, borderColor: "transparent", borderWidth: 0,
          trigger: { type: "none" }
        },
        {
          id: "t4_resp_choices",
          type: "choice",
          left: 100, top: 80, width: 600, height: 130,
          text: "Từ tiếng Anh đúng điền vào chỗ trống:",
          options: "{{dual_english_opts}}",
          fontSize: 13, color: "#007a48",
          backgroundColor: "rgba(255,255,255,0.01)", borderRadius: 8, borderColor: "rgba(255,255,255,0.05)", borderWidth: 1,
          trigger: { type: "none" }
        },
        {
          id: "t4_resp_prompt_math",
          type: "text",
          left: 100, top: 225, width: 600, height: 35,
          text: "Đáp số của phép toán lúc nãy:",
          fontSize: 14, color: "#10b981",
          backgroundColor: "transparent", borderRadius: 0, borderColor: "transparent", borderWidth: 0,
          trigger: { type: "none" }
        },
        {
          id: "t4_resp_input",
          type: "input",
          left: 200, top: 270, width: 400, height: 45,
          backgroundColor: "rgba(0,0,0,0.3)", borderRadius: 6, borderColor: "rgba(255,255,255,0.15)", borderWidth: 1,
          trigger: { type: "none" }
        },
        {
          id: "t4_resp_submit",
          type: "button",
          left: 300, top: 350, width: 200, height: 50,
          text: "Hoàn thành bài Test",
          fontSize: 16, color: "#ffffff",
          backgroundColor: "linear-gradient(135deg, #007a48, #10b981)", borderRadius: 8, borderColor: "transparent", borderWidth: 0,
          trigger: {
            type: "click",
            action: "end",
            correctKey: "{{dual_english_ans}}, {{dual_math_ans}}"
          }
        }
      ]
    };

    state.slides = [
      slideInstructions, slideFixation, 
      slideTask1Memo, slideTask1Input, 
      slideTask2Math, slideTask3English, 
      slideTask4DualMemo, slideTask4DualResponse
    ];

    state.trialsTable = [
      {
        sentence: "Hôm nay tôi ăn phở gà thơm phức cạnh hồ Gươm.",
        correct_sentence: "Hôm nay tôi ăn phở gà thơm phức cạnh hồ Gươm.",
        math_eq: "",
        math_ans: "",
        english_q: "We should avoid _____ too much coffee before bedtime. (drink / drinking / to drink / drank)",
        english_opts: "drink, drinking, to drink, drank",
        english_ans: "drinking",
        dual_english: "I am looking forward to ____ you soon. (see / seeing / seen / saw)",
        dual_english_opts: "see, seeing, seen, saw",
        dual_english_ans: "seeing",
        dual_math: "",
        dual_math_ans: ""
      },
      {
        sentence: "Việt Nam có đường bờ biển dài hình chữ S rất đẹp.",
        correct_sentence: "Việt Nam có đường bờ biển dài hình chữ S rất đẹp.",
        math_eq: "",
        math_ans: "",
        english_q: "If I _____ you, I would study harder. (was / were / am / be)",
        english_opts: "was, were, am, be",
        english_ans: "were",
        dual_english: "He denied _____ the window during the break. (break / breaking / to break / broke)",
        dual_english_opts: "break, breaking, to break, broke",
        dual_english_ans: "breaking",
        dual_math: "",
        dual_math_ans: ""
      }
    ];
  }
  else if (templateType === "stroop") {
    state.projectName = "Thí nghiệm Stroop Màu sắc - Từ ngữ (Kinh điển)";
    state.variables = ["word", "color", "congruent", "correct_key"];
    
    // Create 4 Slides
    // Slide 1: Welcome & Instructions
    const slideInstructions = {
      id: "slide_instructions",
      name: "Hướng dẫn",
      elements: [
        {
          id: "txt_title",
          type: "text",
          left: 100, top: 40, width: 600, height: 60,
          text: "THỬ NGHIỆM ĐO HIỆU ỨNG STROOP",
          fontSize: 28, color: "#22d3ee",
          backgroundColor: "transparent", borderRadius: 0, borderColor: "transparent", borderWidth: 0,
          trigger: { type: "none" }
        },
        {
          id: "txt_body",
          type: "text",
          left: 100, top: 120, width: 600, height: 260,
          text: "Trên màn hình sẽ xuất hiện ngẫu nhiên tên của một màu sắc. Nhiệm vụ của bạn là nhận biết MÀU CHỮ được hiển thị (bỏ qua nghĩa của từ) và nhấn phím tương ứng:\n\n• Nhấn phím 'R' nếu màu chữ là ĐỎ (Red)\n• Nhấn phím 'G' nếu màu chữ là XANH LÁ (Green)\n• Nhấn phím 'B' nếu màu chữ là XANH DƯƠNG (Blue)\n\nVui lòng phản hồi nhanh nhất và chính xác nhất có thể.",
          fontSize: 16, color: "#cbd5e1",
          backgroundColor: "rgba(255,255,255,0.02)", borderRadius: 8, borderColor: "rgba(255,255,255,0.05)", borderWidth: 1,
          trigger: { type: "none" }
        },
        {
          id: "btn_start",
          type: "button",
          left: 300, top: 410, width: 200, height: 50,
          text: "Nhấp để bắt đầu chơi",
          fontSize: 16, color: "#ffffff",
          backgroundColor: "linear-gradient(135deg, #6d28d9, #5b21b6)", borderRadius: 8, borderColor: "rgba(255,255,255,0.1)", borderWidth: 1,
          trigger: {
            type: "click",
            action: "next",
            slideId: "", duration: 0, key: "", correctKey: "", recordCorrect: false
          }
        }
      ]
    };

    // Slide 2: Fixation Cross
    const slideFixation = {
      id: "slide_fixation",
      name: "Tâm Cố Định",
      elements: [
        {
          id: "fixation_cross",
          type: "fixation",
          left: 360, top: 210, width: 80, height: 80,
          text: "+",
          fontSize: 48, color: "#94a3b8",
          backgroundColor: "transparent", borderRadius: 0, borderColor: "transparent", borderWidth: 0,
          trigger: {
            type: "timeout",
            action: "next",
            duration: 800, slideId: "", key: "", correctKey: "", recordCorrect: false
          }
        }
      ]
    };

    // Slide 3: Stimulus Screen
    const slideStimulus = {
      id: "slide_stimulus",
      name: "Kích Thích",
      elements: [
        {
          id: "txt_stimulus",
          type: "text",
          left: 200, top: 180, width: 400, height: 120,
          text: "{{word}}",
          fontSize: 60, color: "{{color}}",
          backgroundColor: "transparent", borderRadius: 0, borderColor: "transparent", borderWidth: 0,
          trigger: {
            type: "keypress",
            action: "end", // Ends the trial, logs response
            key: "r,g,b",
            correctKey: "{{correct_key}}",
            duration: 0, slideId: "", recordCorrect: true
          }
        },
        {
          id: "txt_hint",
          type: "text",
          left: 150, top: 440, width: 500, height: 40,
          text: "Màu Đỏ [R]  |  Màu Xanh Lá [G]  |  Màu Xanh Dương [B]",
          fontSize: 13, color: "#64748b",
          backgroundColor: "transparent", borderRadius: 0, borderColor: "transparent", borderWidth: 0,
          trigger: { type: "none" }
        }
      ]
    };

    // Slide 4: Brief Feedback
    const slideFeedback = {
      id: "slide_feedback",
      name: "Phản Hồi Thử",
      elements: [
        {
          id: "txt_fb_status",
          type: "text",
          left: 250, top: 220, width: 300, height: 60,
          text: "Chuyển sang lượt kế tiếp...",
          fontSize: 20, color: "#a855f7",
          backgroundColor: "transparent", borderRadius: 0, borderColor: "transparent", borderWidth: 0,
          trigger: {
            type: "timeout",
            action: "next",
            duration: 500, slideId: "", key: "", correctKey: "", recordCorrect: false
          }
        }
      ]
    };

    state.slides = [slideInstructions, slideFixation, slideStimulus, slideFeedback];
    
    // Populate Stroop trials matrix: 12 trials
    // columns: ["word", "color", "congruent", "correct_key"]
    state.trialsTable = [
      { word: "ĐỎ", color: "#ef4444", congruent: "Đúng", correct_key: "r" },
      { word: "XANH LÁ", color: "#22c55e", congruent: "Đúng", correct_key: "g" },
      { word: "XANH DƯƠNG", color: "#3b82f6", congruent: "Đúng", correct_key: "b" },
      
      { word: "ĐỎ", color: "#22c55e", congruent: "Sai", correct_key: "g" },
      { word: "ĐỎ", color: "#3b82f6", congruent: "Sai", correct_key: "b" },
      
      { word: "XANH LÁ", color: "#ef4444", congruent: "Sai", correct_key: "r" },
      { word: "XANH LÁ", color: "#3b82f6", congruent: "Sai", correct_key: "b" },
      
      { word: "XANH DƯƠNG", color: "#ef4444", congruent: "Sai", correct_key: "r" },
      { word: "XANH DƯƠNG", color: "#22c55e", congruent: "Sai", correct_key: "g" },
      
      { word: "ĐỎ", color: "#ef4444", congruent: "Đúng", correct_key: "r" },
      { word: "XANH LÁ", color: "#22c55e", congruent: "Đúng", correct_key: "g" },
      { word: "XANH DƯƠNG", color: "#3b82f6", congruent: "Đúng", correct_key: "b" }
    ];
  } 
  else if (templateType === "lexical") {
    state.projectName = "Quyết Định Từ Vựng (Lexical Decision Task)";
    state.variables = ["stimulus", "is_word", "correct_key"];
    
    const slideInstructions = {
      id: "slide_instructions",
      name: "Hướng dẫn",
      elements: [
        {
          id: "txt_title",
          type: "text",
          left: 100, top: 40, width: 600, height: 60,
          text: "THỬ NGHIỆM QUYẾT ĐỊNH TỪ VỰNG",
          fontSize: 28, color: "#06b6d4",
          backgroundColor: "transparent", borderRadius: 0, borderColor: "transparent", borderWidth: 0,
          trigger: { type: "none" }
        },
        {
          id: "txt_body",
          type: "text",
          left: 100, top: 120, width: 600, height: 260,
          text: "Bạn sẽ được quan sát các từ xuất hiện ngẫu nhiên ở trung tâm màn hình.\n\nHãy nhận định xem từ đó có phải là một TỪ TIẾNG VIỆT CÓ NGHĨA hay không:\n\n• Nhấn phím 'M' (Mạnh) nếu đó là Từ Có Nghĩa.\n• Nhấn phím 'Z' nếu đó là Từ Vô Nghĩa / Sai chính tả.\n\nThời gian phản ứng sẽ được đo chính xác.",
          fontSize: 16, color: "#cbd5e1",
          backgroundColor: "rgba(255,255,255,0.02)", borderRadius: 8, borderColor: "rgba(255,255,255,0.05)", borderWidth: 1,
          trigger: { type: "none" }
        },
        {
          id: "btn_start",
          type: "button",
          left: 300, top: 410, width: 200, height: 50,
          text: "Bắt đầu bài kiểm tra",
          fontSize: 16, color: "#ffffff",
          backgroundColor: "#0891b2", borderRadius: 8, borderColor: "rgba(255,255,255,0.1)", borderWidth: 1,
          trigger: {
            type: "click",
            action: "next"
          }
        }
      ]
    };

    const slideFixation = {
      id: "slide_fixation",
      name: "Tâm Cố Định",
      elements: [
        {
          id: "fixation",
          type: "fixation",
          left: 375, top: 220, width: 50, height: 50,
          text: "+",
          fontSize: 40, color: "#64748b",
          backgroundColor: "transparent", borderRadius: 0, borderColor: "transparent", borderWidth: 0,
          trigger: {
            type: "timeout",
            action: "next",
            duration: 600
          }
        }
      ]
    };

    const slideStimulus = {
      id: "slide_stimulus",
      name: "Kích Thích từ",
      elements: [
        {
          id: "txt_word",
          type: "text",
          left: 200, top: 190, width: 400, height: 100,
          text: "{{stimulus}}",
          fontSize: 54, color: "#f8fafc",
          backgroundColor: "transparent", borderRadius: 0, borderColor: "transparent", borderWidth: 0,
          trigger: {
            type: "keypress",
            action: "end",
            key: "m,z",
            correctKey: "{{correct_key}}",
            recordCorrect: true
          }
        },
        {
          id: "txt_reminder",
          type: "text",
          left: 150, top: 440, width: 500, height: 40,
          text: "Từ Có Nghĩa [M]  |  Từ Vô Nghĩa [Z]",
          fontSize: 13, color: "#64748b",
          backgroundColor: "transparent", borderRadius: 0, borderColor: "transparent", borderWidth: 0,
          trigger: { type: "none" }
        }
      ]
    };

    const slideFeedback = {
      id: "slide_feedback",
      name: "Phản hồi",
      elements: [
        {
          id: "txt_fb",
          type: "text",
          left: 250, top: 220, width: 300, height: 50,
          text: "Đang lưu...",
          fontSize: 18, color: "#64748b",
          backgroundColor: "transparent", borderRadius: 0, borderColor: "transparent", borderWidth: 0,
          trigger: {
            type: "timeout",
            action: "next",
            duration: 400
          }
        }
      ]
    };

    state.slides = [slideInstructions, slideFixation, slideStimulus, slideFeedback];
    
    state.trialsTable = [
      { stimulus: "TRƯỜNG HỌC", is_word: "Có", correct_key: "m" },
      { stimulus: "NCREW", is_word: "Không", correct_key: "z" },
      { stimulus: "MÁY TÍNH", is_word: "Có", correct_key: "m" },
      { stimulus: "HỌC BẠN", is_word: "Không", correct_key: "z" },
      { stimulus: "NGHIÊN CỨU", is_word: "Có", correct_key: "m" },
      { stimulus: "KHẠO SÁT", is_word: "Không", correct_key: "z" },
      { stimulus: "THÍ NGHIỆM", is_word: "Có", correct_key: "m" },
      { stimulus: "XƯNG KHUNG", is_word: "Không", correct_key: "z" }
    ];
  } 
  else if (templateType === "gonogo") {
    state.projectName = "Nhóm 2: Phản Xạ Thói Quen (Go/No-Go)";
    state.variables = ["stimulus_type", "color", "borderRadius", "correct_key"];
    
    const slideInstructions = {
      id: "slide_instructions",
      name: "Hướng dẫn",
      elements: [
        {
          id: "txt_title",
          type: "text",
          left: 100, top: 40, width: 600, height: 60,
          text: "NHÓM 2: PHẢN XẠ THÓI QUEN (GO / NO-GO)",
          fontSize: 26, color: "#007a48",
          backgroundColor: "transparent", borderRadius: 0, borderColor: "transparent", borderWidth: 0,
          trigger: { type: "none" }
        },
        {
          id: "txt_body",
          type: "text",
          left: 100, top: 120, width: 600, height: 260,
          text: "Kích thích hình khối sẽ xuất hiện liên tục ở giữa màn hình:\n\n• Nhấn phím SPACE (Dấu cách) thật nhanh khi thấy HÌNH TRÒN (Go).\n• TUYỆT ĐỐI KHÔNG NHẤN phím khi thấy HÌNH VUÔNG (No-Go).\n\nBạn sẽ chỉ có 1200ms để phản hồi mỗi hình. Hãy kiểm soát phản xạ của bạn!",
          fontSize: 16, color: "#cbd5e1",
          backgroundColor: "rgba(255,255,255,0.02)", borderRadius: 8, borderColor: "rgba(255,255,255,0.05)", borderWidth: 1,
          trigger: { type: "none" }
        },
        {
          id: "btn_start",
          type: "button",
          left: 300, top: 410, width: 200, height: 50,
          text: "Bắt đầu",
          fontSize: 16, color: "#ffffff",
          backgroundColor: "linear-gradient(135deg, #007a48, #10b981)",
          borderRadius: 8, borderColor: "rgba(255,255,255,0.1)", borderWidth: 1,
          trigger: {
            type: "click",
            action: "next"
          }
        }
      ]
    };

    const slideFixation = {
      id: "slide_fixation",
      name: "Chuẩn bị",
      elements: [
        {
          id: "fix",
          type: "fixation",
          left: 375, top: 220, width: 50, height: 50,
          text: "+",
          fontSize: 40, color: "#007a48",
          backgroundColor: "transparent", borderRadius: 0, borderColor: "transparent", borderWidth: 0,
          trigger: {
            type: "timeout",
            action: "next",
            duration: 500
          }
        }
      ]
    };

    const slideStimulus = {
      id: "slide_stimulus",
      name: "Hình ảnh Go/NoGo",
      elements: [
        {
          // A shape represented as dynamic rounded div
          id: "shape_stim",
          type: "zone", // use zone block as a generic shape container
          left: 320, top: 170, width: 160, height: 160,
          text: "",
          fontSize: 12, color: "transparent",
          backgroundColor: "{{color}}", 
          borderRadius: "{{borderRadius}}", // we can write custom templates for properties
          borderColor: "rgba(255,255,255,0.2)", borderWidth: 2,
          trigger: {
            type: "timeout", // if no response -> timeout -> ends trial
            action: "end",
            duration: 1200, // max response window
            correctKey: "{{correct_key}}" // if Go: key=space. If No-Go: key= (none)
          }
        },
        {
          id: "shape_listener",
          type: "text",
          left: 10, top: 10, width: 50, height: 50,
          text: "",
          fontSize: 12, color: "transparent",
          backgroundColor: "transparent", borderRadius: 0, borderColor: "transparent", borderWidth: 0,
          trigger: {
            type: "keypress",
            action: "end",
            key: " ",
            correctKey: "{{correct_key}}",
            recordCorrect: true
          }
        }
      ]
    };

    state.slides = [slideInstructions, slideFixation, slideStimulus];
    state.variables = ["stimulus_type", "color", "borderRadius", "correct_key"];
    
    state.trialsTable = [
      { stimulus_type: "Go (Tròn)", color: "#10b981", borderRadius: 90, correct_key: " " },
      { stimulus_type: "Go (Tròn)", color: "#10b981", borderRadius: 90, correct_key: " " },
      { stimulus_type: "No-Go (Vuông)", color: "#f43f5e", borderRadius: 4, correct_key: "" },
      { stimulus_type: "Go (Tròn)", color: "#10b981", borderRadius: 90, correct_key: " " },
      { stimulus_type: "Go (Tròn)", color: "#10b981", borderRadius: 90, correct_key: " " },
      { stimulus_type: "No-Go (Vuông)", color: "#f43f5e", borderRadius: 4, correct_key: "" },
      { stimulus_type: "Go (Tròn)", color: "#10b981", borderRadius: 90, correct_key: " " },
      { stimulus_type: "No-Go (Vuông)", color: "#f43f5e", borderRadius: 4, correct_key: "" },
      { stimulus_type: "Go (Tròn)", color: "#10b981", borderRadius: 90, correct_key: " " },
      { stimulus_type: "Go (Tròn)", color: "#10b981", borderRadius: 90, correct_key: " " }
    ];
  }
  else if (templateType === "group3_audio") {
    state.projectName = "Nhóm 3: Trí Nhớ Thính Giác (Audio Memory)";
    state.variables = ["audio_text", "correct_lyric"];
    
    const slideInstructions = {
      id: "slide_instructions",
      name: "Hướng dẫn",
      elements: [
        {
          id: "txt_title",
          type: "text",
          left: 100, top: 40, width: 600, height: 60,
          text: "NHÓM 3: TRÍ NHỚ THÍNH GIÁC (AUDIO MEMORY)",
          fontSize: 26, color: "#007a48",
          backgroundColor: "transparent", borderRadius: 0, borderColor: "transparent", borderWidth: 0,
          trigger: { type: "none" }
        },
        {
          id: "txt_body",
          type: "text",
          left: 100, top: 120, width: 600, height: 260,
          text: "Bạn sẽ tham gia bài kiểm tra trí nhớ thính giác bằng cách nghe một đoạn âm thanh:\n\n1. Một đoạn âm thanh (tiếng nói hoặc lời câu hát) sẽ tự động phát ra.\n2. Hãy tập trung lắng nghe thật kỹ nội dung âm thanh đó.\n3. Sau khi kết thúc, hãy gõ lại chính xác nội dung câu hát/âm thanh bạn vừa nghe được.\n\nNhấp vào nút bên dưới để bắt đầu chơi.",
          fontSize: 16, color: "#cbd5e1",
          backgroundColor: "rgba(255,255,255,0.02)", borderRadius: 8, borderColor: "rgba(255,255,255,0.05)", borderWidth: 1,
          trigger: { type: "none" }
        },
        {
          id: "btn_start",
          type: "button",
          left: 300, top: 410, width: 200, height: 50,
          text: "Bắt đầu",
          fontSize: 16, color: "#ffffff",
          backgroundColor: "linear-gradient(135deg, #007a48, #10b981)",
          borderRadius: 8, borderColor: "rgba(255,255,255,0.1)", borderWidth: 1,
          trigger: {
            type: "click",
            action: "next"
          }
        }
      ]
    };

    const slideFixation = {
      id: "slide_fixation",
      name: "Chuẩn bị",
      elements: [
        {
          id: "fix",
          type: "fixation",
          left: 375, top: 220, width: 50, height: 50,
          text: "+",
          fontSize: 40, color: "#007a48",
          backgroundColor: "transparent", borderRadius: 0, borderColor: "transparent", borderWidth: 0,
          trigger: {
            type: "timeout",
            action: "next",
            duration: 1000
          }
        }
      ]
    };

    const slideAudioPlay = {
      id: "slide_audio_play",
      name: "Nghe âm thanh",
      elements: [
        {
          id: "txt_listen_prompt",
          type: "text",
          left: 100, top: 80, width: 600, height: 60,
          text: "Hãy tập trung lắng nghe đoạn âm thanh sau:",
          fontSize: 22, color: "#ffffff",
          backgroundColor: "transparent", borderRadius: 0, borderColor: "transparent", borderWidth: 0,
          trigger: { type: "none" }
        },
        {
          id: "audio_stimulus",
          type: "audio",
          left: 310, top: 180, width: 180, height: 80,
          text: "{{audio_text}}",
          fontSize: 14, color: "#007a48",
          backgroundColor: "rgba(0, 122, 72, 0.05)", borderRadius: 8, borderColor: "rgba(0, 122, 72, 0.2)", borderWidth: 1,
          trigger: {
            type: "timeout",
            action: "next",
            duration: 6000
          }
        },
        {
          id: "txt_audio_hint",
          type: "text",
          left: 150, top: 320, width: 500, height: 40,
          text: "🔊 Hệ thống đang phát âm thanh...",
          fontSize: 14, color: "#10b981",
          backgroundColor: "transparent", borderRadius: 0, borderColor: "transparent", borderWidth: 0,
          trigger: { type: "none" }
        }
      ]
    };

    const slideRecallInput = {
      id: "slide_recall_input",
      name: "Nhập đáp án câu hát",
      elements: [
        {
          id: "recall_prompt",
          type: "text",
          left: 100, top: 80, width: 600, height: 50,
          text: "Hãy gõ lại chính xác nội dung bạn vừa nghe được:",
          fontSize: 18, color: "#ffffff",
          backgroundColor: "transparent", borderRadius: 0, borderColor: "transparent", borderWidth: 0,
          trigger: { type: "none" }
        },
        {
          id: "recall_input_box",
          type: "input",
          left: 100, top: 160, width: 600, height: 80,
          backgroundColor: "rgba(0,0,0,0.3)", borderRadius: 8, borderColor: "rgba(255,255,255,0.15)", borderWidth: 1,
          trigger: { type: "none" }
        },
        {
          id: "recall_submit",
          type: "button",
          left: 300, top: 290, width: 200, height: 50,
          text: "Xác nhận",
          fontSize: 16, color: "#ffffff",
          backgroundColor: "#007a48", borderRadius: 8, borderColor: "transparent", borderWidth: 0,
          trigger: {
            type: "click",
            action: "end",
            correctKey: "{{correct_lyric}}"
          }
        }
      ]
    };

    state.slides = [slideInstructions, slideFixation, slideAudioPlay, slideRecallInput];
    
    state.trialsTable = [
      {
        audio_text: "Một bông hồng em dành tặng cô",
        correct_lyric: "Một bông hồng em dành tặng cô"
      },
      {
        audio_text: "Hà Nội mùa này vắng những cơn mưa",
        correct_lyric: "Hà Nội mùa này vắng những cơn mưa"
      },
      {
        audio_text: "Em ơi có bao nhiêu sáu mươi năm cuộc đời",
        correct_lyric: "Em ơi có bao nhiêu sáu mươi năm cuộc đời"
      }
    ];
  }

  saveStateToLocalStorage();
  initUI();
  closeTemplatesModal();
  showNotification(`Đã tải mẫu: ${state.projectName}`);
}

// ===== 5. VIEW SWITCHING =====
function switchTab(tabId) {
  state.activeTab = tabId;
  saveStateToLocalStorage();
  
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.classList.remove("active");
  });
  document.querySelectorAll(".tab-panel").forEach(panel => {
    panel.classList.remove("active");
  });
  
  const activeBtn = document.getElementById(`tab-${tabId}`);
  if (activeBtn) activeBtn.classList.add("active");
  
  const activePanel = document.getElementById(`panel-${tabId}`);
  if (activePanel) activePanel.classList.add("active");
  
  if (tabId === "results") {
    renderRunsHistory();
    renderResultsTable();
    drawAnalyticsChart();
  }
}

// ===== 6. SLIDES MANAGEMENT =====
function renderSlidesList() {
  const container = document.getElementById("slides-list");
  container.innerHTML = "";
  
  state.slides.forEach((slide, index) => {
    const el = document.createElement("div");
    el.className = `slide-thumbnail ${slide.id === state.selectedSlideId ? 'active' : ''}`;
    el.onclick = () => selectSlide(slide.id);
    
    el.innerHTML = `
      <div class="slide-info">
        <span class="slide-num">${index + 1}</span>
        <span class="slide-name">${escapeHTML(slide.name)}</span>
      </div>
      <div class="slide-actions">
        <button class="slide-action-btn delete" onclick="event.stopPropagation(); deleteSlide('${slide.id}')" title="Xóa slide">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>
    `;
    container.appendChild(el);
  });
}

function selectSlide(slideId) {
  state.selectedSlideId = slideId;
  state.selectedElementId = null;
  saveStateToLocalStorage();
  
  // Update slide list visual active state
  document.querySelectorAll(".slide-thumbnail").forEach(el => el.classList.remove("active"));
  renderSlidesList();
  
  renderCanvas();
  deselectElementUI();
}

function addSlide() {
  const id = "slide_" + Date.now();
  const index = state.slides.length + 1;
  const newSlide = {
    id: id,
    name: `Slide mới ${index}`,
    elements: []
  };
  state.slides.push(newSlide);
  saveStateToLocalStorage();
  renderSlidesList();
  selectSlide(id);
  showNotification("Đã thêm Slide mới");
}

function deleteSlide(slideId) {
  if (state.slides.length <= 1) {
    showNotification("Thí nghiệm cần tối thiểu 1 Slide!", "danger");
    return;
  }
  
  const index = state.slides.findIndex(s => s.id === slideId);
  state.slides = state.slides.filter(s => s.id !== slideId);
  saveStateToLocalStorage();
  
  if (state.selectedSlideId === slideId) {
    const nextActive = state.slides[Math.max(0, index - 1)];
    selectSlide(nextActive.id);
  } else {
    renderSlidesList();
  }
  showNotification("Đã xóa Slide");
}

// ===== 7. CANVAS & DRAWING ENGINE =====
function renderCanvas() {
  const viewport = document.getElementById("canvas-viewport");
  
  // Clear elements but keep guides
  const guideH = document.getElementById("guide-h");
  const guideV = document.getElementById("guide-v");
  viewport.innerHTML = "";
  viewport.appendChild(guideH);
  viewport.appendChild(guideV);
  
  const currentSlide = state.slides.find(s => s.id === state.selectedSlideId);
  if (!currentSlide) return;
  
  currentSlide.elements.forEach(el => {
    const div = document.createElement("div");
    div.id = `canvas-el-${el.id}`;
    div.className = `canvas-element canvas-element-${el.type} ${el.id === state.selectedElementId ? 'selected' : ''}`;
    
    // Apply styling
    div.style.left = `${el.left}px`;
    div.style.top = `${el.top}px`;
    div.style.width = `${el.width}px`;
    div.style.height = `${el.height}px`;
    div.style.backgroundColor = el.backgroundColor || "transparent";
    div.style.borderRadius = `${el.borderRadius || 0}px`;
    div.style.borderColor = el.borderColor || "transparent";
    div.style.borderWidth = `${el.borderWidth || 0}px`;
    div.style.borderStyle = el.borderWidth ? "solid" : "none";
    
    // Type specific styles & content
    if (el.type === "text" || el.type === "fixation") {
      div.textContent = el.text || "";
      div.style.fontSize = `${el.fontSize || 18}px`;
      div.style.color = el.color || "#ffffff";
    } 
    else if (el.type === "button") {
      div.textContent = el.text || "Button";
      div.style.fontSize = `${el.fontSize || 14}px`;
      div.style.color = el.color || "#ffffff";
    } 
    else if (el.type === "image") {
      if (el.src) {
        div.style.backgroundImage = `url('${el.src}')`;
        div.classList.add("has-image");
      } else {
        div.classList.remove("has-image");
      }
    }
    else if (el.type === "choice") {
      div.style.flexDirection = "column";
      div.style.alignItems = "stretch";
      div.style.justifyContent = "center";
      div.style.padding = "8px";
      div.style.display = "flex";
      
      const qText = document.createElement("div");
      qText.style.fontSize = `${el.fontSize || 16}px`;
      qText.style.color = el.color || "#ffffff";
      qText.style.textAlign = "center";
      qText.style.marginBottom = "6px";
      qText.textContent = el.text || "Câu hỏi trắc nghiệm?";
      div.appendChild(qText);
      
      const optsContainer = document.createElement("div");
      optsContainer.style.display = "flex";
      optsContainer.style.gap = "6px";
      optsContainer.style.justifyContent = "center";
      optsContainer.style.flexWrap = "wrap";
      
      const opts = (el.options || "Có, Không").split(",").map(o => o.trim());
      opts.forEach(opt => {
        const optBtn = document.createElement("button");
        optBtn.style.padding = "3px 8px";
        optBtn.style.fontSize = "11px";
        optBtn.style.borderRadius = "4px";
        optBtn.style.border = "1px solid rgba(255,255,255,0.15)";
        optBtn.style.backgroundColor = "rgba(255,255,255,0.05)";
        optBtn.style.color = "#ffffff";
        optBtn.style.pointerEvents = "none";
        optBtn.textContent = opt;
        optsContainer.appendChild(optBtn);
      });
      div.appendChild(optsContainer);
    }
    else if (el.type === "audio") {
      div.style.flexDirection = "row";
      div.style.gap = "10px";
      div.style.padding = "10px";
      div.style.display = "flex";
      div.style.alignItems = "center";
      div.style.justifyContent = "center";
      
      const icon = document.createElement("span");
      icon.style.fontSize = "24px";
      icon.textContent = "🔊";
      div.appendChild(icon);
      
      const details = document.createElement("div");
      details.style.display = "flex";
      details.style.flexDirection = "column";
      
      const title = document.createElement("span");
      title.style.fontSize = "11px";
      title.style.fontWeight = "700";
      title.style.color = "var(--primary-accent)";
      title.style.textTransform = "uppercase";
      title.textContent = "Âm thanh (TTS)";
      details.appendChild(title);
      
      const descText = document.createElement("span");
      descText.style.fontSize = `${el.fontSize || 13}px`;
      descText.style.color = el.color || "var(--text-primary)";
      descText.style.wordBreak = "break-all";
      descText.style.whiteSpace = "nowrap";
      descText.style.overflow = "hidden";
      descText.style.textOverflow = "ellipsis";
      descText.style.maxWidth = "130px";
      descText.textContent = el.text || "Đoạn thuyết minh...";
      details.appendChild(descText);
      
      div.appendChild(details);
    }
    
    // Mouse mousedown logic for drag & resize
    div.onmousedown = (e) => handleElementMouseDown(e, el.id);
    
    // Add resize handles if selected
    if (el.id === state.selectedElementId) {
      const handles = ["tl", "tr", "bl", "br"];
      handles.forEach(dir => {
        const handle = document.createElement("div");
        handle.className = `resize-handle handle-${dir}`;
        handle.onmousedown = (e) => {
          e.stopPropagation();
          handleResizeMouseDown(e, el.id, dir);
        };
        div.appendChild(handle);
      });
    }
    
    viewport.appendChild(div);
  });
}

// Add elements from toolbar
function addNewElement(type) {
  const currentSlide = state.slides.find(s => s.id === state.selectedSlideId);
  if (!currentSlide) {
    showNotification("Hãy chọn hoặc tạo một Slide trước!", "danger");
    return;
  }
  
  const id = `el_${type}_${Date.now()}`;
  let newElem = {
    id: id,
    type: type,
    left: 300,
    top: 200,
    width: 200,
    height: 80,
    backgroundColor: "transparent",
    borderRadius: 0,
    borderColor: "transparent",
    borderWidth: 0,
    trigger: {
      type: "none",
      action: "next",
      slideId: "",
      duration: 1000,
      key: "",
      correctKey: "",
      recordCorrect: false
    }
  };
  
  // Custom sizing & values based on type
  if (type === "text") {
    newElem.width = 300;
    newElem.height = 60;
    newElem.text = "Nhập văn bản ở đây";
    newElem.fontSize = 20;
    newElem.color = "#ffffff";
  } 
  else if (type === "fixation") {
    newElem.width = 60;
    newElem.height = 60;
    newElem.left = 370;
    newElem.top = 220;
    newElem.text = "+";
    newElem.fontSize = 40;
    newElem.color = "#94a3b8";
    newElem.trigger.type = "timeout";
    newElem.trigger.duration = 800;
  } 
  else if (type === "button") {
    newElem.width = 160;
    newElem.height = 45;
    newElem.text = "Nút bấm";
    newElem.fontSize = 15;
    newElem.color = "#ffffff";
    newElem.backgroundColor = "linear-gradient(135deg, #6d28d9, #5b21b6)";
    newElem.borderRadius = 8;
    newElem.borderWidth = 1;
    newElem.borderColor = "rgba(255,255,255,0.1)";
    newElem.trigger.type = "click";
  } 
  else if (type === "image") {
    newElem.width = 250;
    newElem.height = 180;
    newElem.src = "";
    newElem.backgroundColor = "rgba(255,255,255,0.02)";
    newElem.borderWidth = 1;
    newElem.borderColor = "rgba(255,255,255,0.1)";
  }
  else if (type === "input") {
    newElem.width = 280;
    newElem.height = 45;
    newElem.backgroundColor = "rgba(0,0,0,0.3)";
    newElem.borderRadius = 6;
    newElem.borderWidth = 1;
    newElem.borderColor = "rgba(255,255,255,0.15)";
    newElem.trigger.type = "keypress";
    newElem.trigger.key = "Enter";
  }
  else if (type === "zone") {
    newElem.width = 200;
    newElem.height = 150;
    newElem.borderColor = "#06b6d4";
    newElem.borderWidth = 2;
    newElem.borderRadius = 8;
  }
  else if (type === "choice") {
    newElem.width = 320;
    newElem.height = 120;
    newElem.text = "Bạn có đồng ý không?";
    newElem.options = "Có, Không";
    newElem.fontSize = 16;
    newElem.color = "#ffffff";
    newElem.backgroundColor = "rgba(255,255,255,0.03)";
    newElem.borderRadius = 8;
    newElem.borderWidth = 1;
    newElem.borderColor = "rgba(255,255,255,0.1)";
    newElem.trigger.type = "keypress";
    newElem.trigger.action = "end";
    newElem.trigger.correctKey = "";
  }
  else if (type === "audio") {
    newElem.width = 180;
    newElem.height = 80;
    newElem.text = "Một bông hồng em dành tặng cô";
    newElem.fontSize = 14;
    newElem.color = "#007a48";
    newElem.backgroundColor = "rgba(0, 122, 72, 0.05)";
    newElem.borderRadius = 8;
    newElem.borderWidth = 1;
    newElem.borderColor = "rgba(0, 122, 72, 0.2)";
    newElem.trigger.type = "timeout";
    newElem.trigger.duration = 5000; // default 5 seconds to read
    newElem.trigger.action = "next";
  }
  
  currentSlide.elements.push(newElem);
  saveStateToLocalStorage();
  renderCanvas();
  selectElement(id);
  showNotification(`Đã thêm thành phần: ${type}`);
}

// ===== 8. DRAG AND RESIZE LOGIC =====
function handleElementMouseDown(e, elementId) {
  e.preventDefault();
  selectElement(elementId);
  
  const currentSlide = state.slides.find(s => s.id === state.selectedSlideId);
  const el = currentSlide.elements.find(item => item.id === elementId);
  if (!el) return;
  
  canvasDragState.isDragging = true;
  canvasDragState.isResizing = false;
  canvasDragState.elemId = elementId;
  canvasDragState.startX = e.clientX;
  canvasDragState.startY = e.clientY;
  canvasDragState.startLeft = el.left;
  canvasDragState.startTop = el.top;
}

function handleResizeMouseDown(e, elementId, direction) {
  e.preventDefault();
  e.stopPropagation();
  
  const currentSlide = state.slides.find(s => s.id === state.selectedSlideId);
  const el = currentSlide.elements.find(item => item.id === elementId);
  if (!el) return;
  
  canvasDragState.isDragging = false;
  canvasDragState.isResizing = true;
  canvasDragState.elemId = elementId;
  canvasDragState.resizeDirection = direction;
  canvasDragState.startX = e.clientX;
  canvasDragState.startY = e.clientY;
  canvasDragState.startLeft = el.left;
  canvasDragState.startTop = el.top;
  canvasDragState.startWidth = el.width;
  canvasDragState.startHeight = el.height;
}

function handleCanvasMouseMove(e) {
  if (!canvasDragState.isDragging && !canvasDragState.isResizing) return;
  
  const currentSlide = state.slides.find(s => s.id === state.selectedSlideId);
  if (!currentSlide) return;
  
  const el = currentSlide.elements.find(item => item.id === canvasDragState.elemId);
  if (!el) return;
  
  const dx = e.clientX - canvasDragState.startX;
  const dy = e.clientY - canvasDragState.startY;
  
  if (canvasDragState.isDragging) {
    let newLeft = canvasDragState.startLeft + dx;
    let newTop = canvasDragState.startTop + dy;
    
    // Snap to grid & canvas bounds
    newLeft = Math.max(0, Math.min(800 - el.width, Math.round(newLeft / 5) * 5));
    newTop = Math.max(0, Math.min(500 - el.height, Math.round(newTop / 5) * 5));
    
    el.left = newLeft;
    el.top = newTop;
    
    // Smart guides snapping to center
    const guideH = document.getElementById("guide-h");
    const guideV = document.getElementById("guide-v");
    const centerH = newTop + el.height / 2;
    const centerV = newLeft + el.width / 2;
    
    // Horizontal center snapping (Y center = 250)
    if (Math.abs(centerH - 250) < 6) {
      el.top = 250 - el.height / 2;
      guideH.style.opacity = 1;
    } else {
      guideH.style.opacity = 0;
    }
    
    // Vertical center snapping (X center = 400)
    if (Math.abs(centerV - 400) < 6) {
      el.left = 400 - el.width / 2;
      guideV.style.opacity = 1;
    } else {
      guideV.style.opacity = 0;
    }
  } 
  else if (canvasDragState.isResizing) {
    const dir = canvasDragState.resizeDirection;
    let newWidth = canvasDragState.startWidth;
    let newHeight = canvasDragState.startHeight;
    let newLeft = canvasDragState.startLeft;
    let newTop = canvasDragState.startTop;
    
    if (dir.includes("r")) {
      newWidth = Math.max(20, Math.round((canvasDragState.startWidth + dx) / 5) * 5);
    }
    if (dir.includes("b")) {
      newHeight = Math.max(20, Math.round((canvasDragState.startHeight + dy) / 5) * 5);
    }
    if (dir.includes("l")) {
      const possibleWidth = canvasDragState.startWidth - dx;
      if (possibleWidth > 20) {
        newWidth = Math.round(possibleWidth / 5) * 5;
        newLeft = Math.round((canvasDragState.startLeft + dx) / 5) * 5;
      }
    }
    if (dir.includes("t")) {
      const possibleHeight = canvasDragState.startHeight - dy;
      if (possibleHeight > 20) {
        newHeight = Math.round(possibleHeight / 5) * 5;
        newTop = Math.round((canvasDragState.startTop + dy) / 5) * 5;
      }
    }
    
    // Bounds check
    if (newLeft >= 0 && newLeft + newWidth <= 800) {
      el.left = newLeft;
      el.width = newWidth;
    }
    if (newTop >= 0 && newTop + newHeight <= 500) {
      el.top = newTop;
      el.height = newHeight;
    }
  }
  
  // Real-time DOM style updating (smoother than full react-like render)
  const div = document.getElementById(`canvas-el-${el.id}`);
  if (div) {
    div.style.left = `${el.left}px`;
    div.style.top = `${el.top}px`;
    div.style.width = `${el.width}px`;
    div.style.height = `${el.height}px`;
  }
  
  // Update inspector numerical inputs
  document.getElementById("elem-left").value = el.left;
  document.getElementById("elem-top").value = el.top;
  document.getElementById("elem-width").value = el.width;
  document.getElementById("elem-height").value = el.height;
}

function handleCanvasMouseUp(e) {
  if (canvasDragState.isDragging || canvasDragState.isResizing) {
    canvasDragState.isDragging = false;
    canvasDragState.isResizing = false;
    document.getElementById("guide-h").style.opacity = 0;
    document.getElementById("guide-v").style.opacity = 0;
    saveStateToLocalStorage();
    renderCanvas();
  }
}

// ===== 9. PROPERTIES & INSPECTOR BINDING =====
function selectElement(elementId) {
  state.selectedElementId = elementId;
  saveStateToLocalStorage();
  
  // Highlight active element on canvas
  document.querySelectorAll(".canvas-element").forEach(el => el.classList.remove("selected"));
  const activeDiv = document.getElementById(`canvas-el-${elementId}`);
  if (activeDiv) activeDiv.classList.add("selected");
  
  // Refresh resize handles
  renderCanvas();
  
  // Load inspector contents
  const currentSlide = state.slides.find(s => s.id === state.selectedSlideId);
  const el = currentSlide.elements.find(item => item.id === elementId);
  
  if (el) {
    document.getElementById("inspector-empty-state").style.display = "none";
    document.getElementById("inspector-active-state").style.display = "block";
    
    // Style fields
    document.getElementById("elem-id").value = el.id;
    document.getElementById("elem-left").value = el.left;
    document.getElementById("elem-top").value = el.top;
    document.getElementById("elem-width").value = el.width;
    document.getElementById("elem-height").value = el.height;
    document.getElementById("elem-bg-color").value = el.backgroundColor || "transparent";
    document.getElementById("elem-border-radius").value = el.borderRadius || 0;
    document.getElementById("elem-border-color").value = el.borderColor || "";
    document.getElementById("elem-border-width").value = el.borderWidth || 0;
    
    // Type specific fields toggle
    const textGroup = document.getElementById("group-text-properties");
    const imageGroup = document.getElementById("group-image-properties");
    const choiceGroup = document.getElementById("group-choice-properties");
    const audioGroup = document.getElementById("group-audio-properties");
    
    if (el.type === "text" || el.type === "fixation" || el.type === "button" || el.type === "choice" || el.type === "audio") {
      textGroup.style.display = "block";
      document.getElementById("elem-text").value = el.text || "";
      document.getElementById("elem-font-size").value = el.fontSize || 18;
      document.getElementById("elem-font-color").value = el.color || "#ffffff";
      
      const txtInput = document.getElementById("elem-text");
      const txtLabel = document.getElementById("label-elem-text");
      if (el.type === "audio") {
        if (txtInput) txtInput.style.display = "none";
        if (txtLabel) txtLabel.style.display = "none";
      } else {
        if (txtInput) txtInput.style.display = "block";
        if (txtLabel) txtLabel.style.display = "block";
      }
    } else {
      textGroup.style.display = "none";
    }
    
    if (el.type === "image") {
      imageGroup.style.display = "block";
      document.getElementById("elem-src").value = el.src || "";
    } else {
      imageGroup.style.display = "none";
    }
    
    if (el.type === "choice") {
      choiceGroup.style.display = "block";
      document.getElementById("elem-options").value = el.options || "Có, Không";
    } else {
      choiceGroup.style.display = "none";
    }
    
    if (el.type === "audio") {
      if (audioGroup) {
        audioGroup.style.display = "block";
        document.getElementById("elem-audio-text").value = el.text || "";
      }
    } else {
      if (audioGroup) {
        audioGroup.style.display = "none";
      }
    }
    
    // Triggers / Logic tab loading
    loadInspectorLogicPanel(el);
  }
}

function deselectElementUI() {
  document.getElementById("inspector-empty-state").style.display = "flex";
  document.getElementById("inspector-active-state").style.display = "none";
}

function updateSelectedElementProperty(prop, value) {
  const currentSlide = state.slides.find(s => s.id === state.selectedSlideId);
  if (!currentSlide) return;
  const el = currentSlide.elements.find(item => item.id === state.selectedElementId);
  if (!el) return;
  
  el[prop] = value;
  saveStateToLocalStorage();
  
  // Realtime render of style/text
  const div = document.getElementById(`canvas-el-${el.id}`);
  if (div) {
    if (prop === "text" && (el.type === "text" || el.type === "fixation" || el.type === "button")) {
      div.textContent = value;
    } else if (prop === "fontSize") {
      div.style.fontSize = `${value}px`;
    } else if (prop === "color") {
      div.style.color = value;
    } else if (prop === "backgroundColor") {
      div.style.backgroundColor = value;
    } else if (prop === "borderRadius") {
      div.style.borderRadius = `${value}px`;
    } else if (prop === "borderColor") {
      div.style.borderColor = value;
    } else if (prop === "borderWidth") {
      div.style.borderWidth = `${value}px`;
      div.style.borderStyle = value ? "solid" : "none";
    } else if (prop === "src" && el.type === "image") {
      if (value) {
        div.style.backgroundImage = `url('${value}')`;
        div.classList.add("has-image");
      } else {
        div.style.backgroundImage = "";
        div.classList.remove("has-image");
      }
    }
  }
  if ((el.type === "choice" || el.type === "audio") && (prop === "text" || prop === "options" || prop === "fontSize" || prop === "color")) {
    renderCanvas();
  }
}

function alignSelectedElement(alignment) {
  const currentSlide = state.slides.find(s => s.id === state.selectedSlideId);
  if (!currentSlide) return;
  const el = currentSlide.elements.find(item => item.id === state.selectedElementId);
  if (!el) return;
  
  if (alignment === "center-h") {
    el.left = 400 - el.width / 2;
  } else if (alignment === "center-v") {
    el.top = 250 - el.height / 2;
  }
  
  saveStateToLocalStorage();
  renderCanvas();
  selectElement(el.id);
}

function deleteSelectedElement() {
  const currentSlide = state.slides.find(s => s.id === state.selectedSlideId);
  if (!currentSlide || !state.selectedElementId) return;
  
  currentSlide.elements = currentSlide.elements.filter(item => item.id !== state.selectedElementId);
  state.selectedElementId = null;
  saveStateToLocalStorage();
  renderCanvas();
  deselectElementUI();
  showNotification("Đã xóa thành phần");
}

function handleGlobalKeyDown(e) {
  // Delete active element on Delete key inside builder view
  if (e.key === "Delete" && state.activeTab === "editor" && state.selectedElementId) {
    // Make sure we're not typing inside input or textarea
    const active = document.activeElement;
    if (active.tagName !== "INPUT" && active.tagName !== "TEXTAREA") {
      deleteSelectedElement();
    }
  }
}

// ===== 10. TRIGGER LOGIC CONFIGURATION =====
function loadInspectorLogicPanel(el) {
  const trig = el.trigger || { type: "none" };
  
  // Set trigger selector value
  document.getElementById("logic-trigger-type").value = trig.type || "none";
  
  // Hide all details panels first
  document.getElementById("trigger-details-click").style.display = "none";
  document.getElementById("trigger-details-keypress").style.display = "none";
  document.getElementById("trigger-details-timeout").style.display = "none";
  
  // Fill options in slide goto selectors
  populateSlideGotoOptions();
  
  if (trig.type === "click") {
    document.getElementById("trigger-details-click").style.display = "block";
    document.getElementById("click-action").value = trig.action || "next";
    document.getElementById("click-record-correct").checked = !!trig.recordCorrect;
    
    const gotoRow = document.getElementById("click-goto-slide-row");
    if (trig.action === "goto") {
      gotoRow.style.display = "flex";
      document.getElementById("click-goto-slide-id").value = trig.slideId || "";
    } else {
      gotoRow.style.display = "none";
    }
  } 
  else if (trig.type === "keypress") {
    document.getElementById("trigger-details-keypress").style.display = "block";
    document.getElementById("keypress-key").value = trig.key || "";
    document.getElementById("keypress-action").value = trig.action || "next";
    document.getElementById("keypress-correct-key").value = trig.correctKey || "";
    
    const gotoRow = document.getElementById("keypress-goto-slide-row");
    if (trig.action === "goto") {
      gotoRow.style.display = "flex";
      document.getElementById("keypress-goto-slide-id").value = trig.slideId || "";
    } else {
      gotoRow.style.display = "none";
    }
  } 
  else if (trig.type === "timeout") {
    document.getElementById("trigger-details-timeout").style.display = "block";
    document.getElementById("timeout-duration").value = trig.duration || 1000;
    document.getElementById("timeout-action").value = trig.action || "next";
    
    const gotoRow = document.getElementById("timeout-goto-slide-row");
    if (trig.action === "goto") {
      gotoRow.style.display = "flex";
      document.getElementById("timeout-goto-slide-id").value = trig.slideId || "";
    } else {
      gotoRow.style.display = "none";
    }
  }
}

function updateElementTriggerType(type) {
  const currentSlide = state.slides.find(s => s.id === state.selectedSlideId);
  if (!currentSlide) return;
  const el = currentSlide.elements.find(item => item.id === state.selectedElementId);
  if (!el) return;
  
  if (!el.trigger) el.trigger = {};
  el.trigger.type = type;
  
  // Set defaults for newly activated trigger type
  if (type === "click") {
    el.trigger.action = "next";
    el.trigger.recordCorrect = false;
  } else if (type === "keypress") {
    el.trigger.key = "";
    el.trigger.action = "end";
    el.trigger.correctKey = "";
  } else if (type === "timeout") {
    el.trigger.duration = 1000;
    el.trigger.action = "next";
  }
  
  saveStateToLocalStorage();
  loadInspectorLogicPanel(el);
}

function updateTriggerAction(triggerType, action) {
  const currentSlide = state.slides.find(s => s.id === state.selectedSlideId);
  const el = currentSlide.elements.find(item => item.id === state.selectedElementId);
  if (!el || !el.trigger) return;
  
  el.trigger.action = action;
  if (action === "goto" && state.slides.length > 0) {
    // Default to first slide
    el.trigger.slideId = state.slides[0].id;
  }
  
  saveStateToLocalStorage();
  loadInspectorLogicPanel(el);
}

function updateTriggerActionParam(triggerType, param, value) {
  const currentSlide = state.slides.find(s => s.id === state.selectedSlideId);
  const el = currentSlide.elements.find(item => item.id === state.selectedElementId);
  if (!el || !el.trigger) return;
  
  el.trigger[param] = value;
  saveStateToLocalStorage();
}

function updateTriggerAccuracy(triggerType, isCorrect) {
  const currentSlide = state.slides.find(s => s.id === state.selectedSlideId);
  const el = currentSlide.elements.find(item => item.id === state.selectedElementId);
  if (!el || !el.trigger) return;
  
  el.trigger.recordCorrect = isCorrect;
  saveStateToLocalStorage();
}

function populateSlideGotoOptions() {
  const clickSelector = document.getElementById("click-goto-slide-id");
  const keypressSelector = document.getElementById("keypress-goto-slide-id");
  const timeoutSelector = document.getElementById("timeout-goto-slide-id");
  
  const optionsHTML = state.slides.map((s, index) => {
    return `<option value="${s.id}">${index + 1}. ${escapeHTML(s.name)}</option>`;
  }).join("");
  
  clickSelector.innerHTML = optionsHTML;
  keypressSelector.innerHTML = optionsHTML;
  timeoutSelector.innerHTML = optionsHTML;
}

function switchInspectorTab(tab) {
  document.getElementById("btn-inspect-style").classList.toggle("active", tab === "style");
  document.getElementById("btn-inspect-logic").classList.toggle("active", tab === "logic");
  
  document.getElementById("inspector-panel-style").classList.toggle("active", tab === "style");
  document.getElementById("inspector-panel-logic").classList.toggle("active", tab === "logic");
}

// ===== 11. SPREADSHEET / TRIAL DESIGN ENGINE =====
function renderTrialsTable() {
  const headerRow = document.getElementById("trials-header-row");
  const body = document.getElementById("trials-body");
  
  // 1. Render Headers
  let headerHTML = `<th style="width: 60px;">Trial #</th>`;
  
  state.variables.forEach((variable, varIdx) => {
    headerHTML += `
      <th>
        <div class="spreadsheet-header-cell">
          <input type="text" value="${escapeHTML(variable)}" 
            class="header-var-name" 
            onchange="renameTrialVariable(${varIdx}, this.value)" 
            title="Đổi tên biến" />
          <button class="delete-col-btn" onclick="deleteTrialVariable(${varIdx})" title="Xóa cột biến này">&times;</button>
        </div>
      </th>
    `;
  });
  headerHTML += `<th class="col-actions">Hành động</th>`;
  headerRow.innerHTML = headerHTML;
  
  // 2. Render Rows
  body.innerHTML = "";
  if (state.trialsTable.length === 0) {
    body.innerHTML = `<tr><td colspan="${state.variables.length + 2}" class="empty-table-placeholder">Chưa có kịch bản kích thích nào. Vui lòng bấm "Thêm hàng (Trial)" để cấu hình.</td></tr>`;
    return;
  }
  
  state.trialsTable.forEach((row, rowIdx) => {
    const tr = document.createElement("tr");
    
    let cellsHTML = `<td style="text-align: center; font-weight: 700; color: var(--primary-accent-light);">${rowIdx + 1}</td>`;
    
    state.variables.forEach(variable => {
      const cellValue = row[variable] !== undefined ? row[variable] : "";
      let placeholder = "";
      if (variable === "math_eq" || variable === "dual_math") {
        placeholder = "Tự động tạo phép tính";
      } else if (variable === "math_ans" || variable === "dual_math_ans") {
        placeholder = "Tự động tạo đáp số";
      }
      
      cellsHTML += `
        <td>
          <input type="text" value="${escapeHTML(String(cellValue))}" 
            class="spreadsheet-input" 
            placeholder="${placeholder}"
            oninput="updateTrialTableCell(${rowIdx}, '${variable}', this.value)" />
        </td>
      `;
    });
    
    cellsHTML += `
      <td>
        <button class="delete-row-btn" onclick="deleteTrialRow(${rowIdx})" title="Xóa trial này">🗑️</button>
      </td>
    `;
    
    tr.innerHTML = cellsHTML;
    body.appendChild(tr);
  });
}

function fillRandomMathInTable() {
  let filledCount = 0;
  state.trialsTable.forEach(row => {
    // Generate for math_eq & math_ans if present and empty
    if ('math_eq' in row && (row['math_eq'] === "" || row['math_eq'] === undefined)) {
      const math = generateRandomMathEquation(false); // standard math
      row['math_eq'] = math.equation;
      row['math_ans'] = math.answer;
      filledCount++;
    }
    
    // Generate for dual_math & dual_math_ans if present and empty
    if ('dual_math' in row && (row['dual_math'] === "" || row['dual_math'] === undefined)) {
      const math = generateRandomMathEquation(true); // simpler math for dual task
      row['dual_math'] = math.equation;
      row['dual_math_ans'] = math.answer;
      filledCount++;
    }
  });

  if (filledCount > 0) {
    saveStateToLocalStorage();
    renderTrialsTable();
    showNotification(`Đã tự động điền phép tính ngẫu nhiên vào ${filledCount} ô!`);
  } else {
    showNotification("Các ô phép tính đã có dữ liệu hoặc bảng hiện tại không cần cột phép tính.", "info");
  }
}

function addTrialRow() {
  let newRow = {};
  state.variables.forEach(v => {
    newRow[v] = "";
  });
  state.trialsTable.push(newRow);
  saveStateToLocalStorage();
  renderTrialsTable();
}

function addTrialColumn() {
  const varName = "var_" + (state.variables.length + 1);
  state.variables.push(varName);
  
  // Add property to all rows
  state.trialsTable.forEach(row => {
    row[varName] = "";
  });
  
  saveStateToLocalStorage();
  renderTrialsTable();
  showNotification(`Đã thêm biến: ${varName}`);
}

function triggerImportFile() {
  document.getElementById("trial-import-input").click();
}

function handleTrialImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  const extension = file.name.split('.').pop().toLowerCase();
  
  if (extension === "xlsx" || extension === "xls") {
    // Excel file parsing via SheetJS
    reader.onload = function(evt) {
      try {
        if (typeof XLSX === "undefined") {
          showNotification("Thư viện Excel chưa được tải. Vui lòng kết nối mạng hoặc nhập file CSV.", "danger");
          return;
        }
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Convert sheet to JSON array of objects
        const json = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
        if (json.length === 0) {
          showNotification("File Excel không có dữ liệu!", "danger");
          return;
        }
        
        // Extract headers
        const headersSet = new Set();
        json.forEach(row => {
          Object.keys(row).forEach(key => headersSet.add(key));
        });
        const headers = Array.from(headersSet);
        
        // Update state
        state.variables = headers;
        state.trialsTable = json.map(row => {
          const formattedRow = {};
          headers.forEach(h => {
            formattedRow[h] = row[h] !== undefined ? String(row[h]) : "";
          });
          return formattedRow;
        });
        
        saveStateToLocalStorage();
        initUI();
        renderTrialsTable();
        showNotification(`Đã nhập thành công ${state.trialsTable.length} hàng từ file Excel!`);
      } catch (err) {
        console.error(err);
        showNotification("Lỗi khi đọc file Excel!", "danger");
      }
    };
    reader.readAsArrayBuffer(file);
  } else {
    // CSV parsing natively (offline-first)
    reader.onload = function(evt) {
      try {
        const text = evt.target.result;
        const rows = parseCSVText(text);
        if (rows.length < 2) {
          showNotification("File CSV cần ít nhất 1 dòng tiêu đề và 1 dòng dữ liệu!", "danger");
          return;
        }
        
        const headers = rows[0].map(h => h.trim()).filter(h => h !== "");
        const trials = [];
        
        for (let i = 1; i < rows.length; i++) {
          const rowData = rows[i];
          if (rowData.length === 0 || (rowData.length === 1 && rowData[0] === "")) continue;
          
          const trialObj = {};
          headers.forEach((header, colIdx) => {
            trialObj[header] = rowData[colIdx] !== undefined ? rowData[colIdx] : "";
          });
          trials.push(trialObj);
        }
        
        if (trials.length === 0) {
          showNotification("Không tìm thấy hàng dữ liệu nào trong CSV!", "danger");
          return;
        }
        
        state.variables = headers;
        state.trialsTable = trials;
        
        saveStateToLocalStorage();
        initUI();
        renderTrialsTable();
        showNotification(`Đã nhập thành công ${state.trialsTable.length} hàng từ file CSV!`);
      } catch (err) {
        console.error(err);
        showNotification("Lỗi khi đọc file CSV!", "danger");
      }
    };
    reader.readAsText(file, "UTF-8");
  }
  
  // Clear input value to allow uploading same file again
  e.target.value = "";
}

function parseCSVText(text) {
  const result = [];
  let row = [];
  let inQuotes = false;
  let entry = "";
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];
    
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        entry += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(entry);
      entry = "";
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++;
      }
      row.push(entry);
      result.push(row);
      row = [];
      entry = "";
    } else {
      entry += char;
    }
  }
  
  if (entry || row.length > 0) {
    row.push(entry);
    result.push(row);
  }
  
  return result;
}

function exportTrialTableCSV() {
  if (state.trialsTable.length === 0) {
    showNotification("Bảng Trials trống, không thể xuất!", "danger");
    return;
  }
  
  const headers = state.variables;
  let csvContent = "\uFEFF"; // UTF-8 BOM
  
  // Header row
  csvContent += headers.map(h => `"${h.replace(/"/g, '""')}"`).join(",") + "\r\n";
  
  // Data rows
  state.trialsTable.forEach(row => {
    const line = headers.map(h => {
      const val = row[h] || "";
      return `"${val.replace(/"/g, '""')}"`;
    }).join(",");
    csvContent += line + "\r\n";
  });
  
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `ipi_test_trials_${state.projectName.replace(/\s+/g, "_").toLowerCase()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function updateTrialTableCell(rowIdx, variable, value) {
  if (state.trialsTable[rowIdx]) {
    state.trialsTable[rowIdx][variable] = value;
    saveStateToLocalStorage();
  }
}

function renameTrialVariable(varIdx, newName) {
  newName = newName.replace(/[^a-zA-Z0-9_]/g, "").trim(); // restrict variables formatting
  if (!newName) {
    showNotification("Tên biến không được để trống!", "danger");
    renderTrialsTable();
    return;
  }
  
  const oldName = state.variables[varIdx];
  if (oldName === newName) return;
  
  if (state.variables.includes(newName)) {
    showNotification("Tên biến đã tồn tại!", "danger");
    renderTrialsTable();
    return;
  }
  
  state.variables[varIdx] = newName;
  
  // Update key name in all trial rows
  state.trialsTable.forEach(row => {
    row[newName] = row[oldName];
    delete row[oldName];
  });
  
  // Update templates inside slide elements triggers/attributes
  state.slides.forEach(slide => {
    slide.elements.forEach(el => {
      // update text
      if (el.text && el.text.includes(`{{${oldName}}}`)) {
        el.text = el.text.replaceAll(`{{${oldName}}}`, `{{${newName}}}`);
      }
      // update color
      if (el.color && el.color.includes(`{{${oldName}}}`)) {
        el.color = el.color.replaceAll(`{{${oldName}}}`, `{{${newName}}}`);
      }
      // update image source
      if (el.src && el.src.includes(`{{${oldName}}}`)) {
        el.src = el.src.replaceAll(`{{${oldName}}}`, `{{${newName}}}`);
      }
      // update triggers
      if (el.trigger) {
        if (el.trigger.key && el.trigger.key.includes(`{{${oldName}}}`)) {
          el.trigger.key = el.trigger.key.replaceAll(`{{${oldName}}}`, `{{${newName}}}`);
        }
        if (el.trigger.correctKey && el.trigger.correctKey.includes(`{{${oldName}}}`)) {
          el.trigger.correctKey = el.trigger.correctKey.replaceAll(`{{${oldName}}}`, `{{${newName}}}`);
        }
      }
    });
  });
  
  saveStateToLocalStorage();
  renderTrialsTable();
  renderCanvas();
  showNotification(`Đã đổi tên biến từ ${oldName} sang ${newName}`);
}

function deleteTrialVariable(varIdx) {
  const varName = state.variables[varIdx];
  if (confirm(`Bạn có chắc chắn muốn xóa cột biến "${varName}"? Tất cả dữ liệu của cột này trên các trials sẽ bị mất.`)) {
    state.variables.splice(varIdx, 1);
    state.trialsTable.forEach(row => {
      delete row[varName];
    });
    saveStateToLocalStorage();
    renderTrialsTable();
  }
}

function deleteTrialRow(rowIdx) {
  state.trialsTable.splice(rowIdx, 1);
  saveStateToLocalStorage();
  renderTrialsTable();
}

function resetTrialMatrixToDefault() {
  if (confirm("Khôi phục bảng trial mẫu? Các chỉnh sửa hiện tại sẽ bị xóa hoàn toàn.")) {
    loadTemplate("type1_1");
  }
}

function updateExperimentSetting(settingKey, value) {
  state.settings[settingKey] = value;
  saveStateToLocalStorage();
}

function updateGSheetUrl(url) {
  state.settings.gsheetUrl = url.trim();
  saveStateToLocalStorage();
  updateSyncStatusIndicator();
}

function updateSyncStatusIndicator() {
  const indicator = document.getElementById("status-indicator");
  const statusText = document.getElementById("status-text");
  
  if (state.settings.gsheetUrl) {
    indicator.className = "status-indicator connected";
    statusText.textContent = "Google Sheets Webhook Sẵn Sàng";
  } else {
    indicator.className = "status-indicator disconnected";
    statusText.textContent = "Chưa kết nối Webhook Google Sheets";
  }
}

// ===== 12. HIGH-PRECISION PLAYBACK PLAYER ENGINE =====
function startExperiment() {
  if (state.slides.length === 0) {
    showNotification("Vui lòng tạo ít nhất 1 Slide trước khi chạy!", "danger");
    return;
  }
  if (state.trialsTable.length === 0) {
    showNotification("Bảng Trials trống! Hãy cấu hình kích thích trước khi chạy.", "danger");
    return;
  }
  
  // Open setup view inside player overlay
  document.getElementById("player-setup-project-name").textContent = state.projectName;
  document.getElementById("player-complete-box").style.display = "none";
  document.getElementById("player-setup-box").style.display = "block";
  document.getElementById("player-viewport").style.display = "none";
  document.getElementById("player-hud").style.display = "none";
  document.getElementById("player-feedback").className = "player-feedback-indicator";
  
  // Set dropdown default value based on mode
  const groupSelect = document.getElementById("player-test-group");
  if (groupSelect) {
    if (isParticipantOnly) {
      groupSelect.value = ""; // forces them to select
    } else {
      groupSelect.value = "current"; // defaults to current active project for admin testing
    }
  }
  
  document.getElementById("experiment-player").classList.add("active");
  
  // Auto participant code
  document.getElementById("participant-name").value = "Subject_" + String(Date.now()).slice(-5);
}

function stopExperiment() {
  // Cancel active timer
  if (playbackState.activeTimerId) {
    clearTimeout(playbackState.activeTimerId);
    playbackState.activeTimerId = null;
  }
  
  // Cancel Speech Synthesis
  window.speechSynthesis.cancel();
  
  playbackState.isActive = false;
  document.getElementById("experiment-player").classList.remove("active");
  
  // Remove player event listeners
  document.removeEventListener("keydown", handlePlayerKeyDown);
}

function launchActivePlayback() {
  const selectedGroup = document.getElementById("player-test-group").value;
  if (!selectedGroup) {
    showNotification("Vui lòng chọn nhóm thí nghiệm trước khi bắt đầu!", "danger");
    return;
  }
  
  const pNameInput = document.getElementById("participant-name").value.trim();
  playbackState.participant = pNameInput || "Ẩn danh";
  playbackState.isActive = true;
  playbackState.runTrialsLog = [];
  playbackState.currentTrialIndex = 0;
  
  // Clone trials and shuffle if randomization is set
  // Use JSON deep clone to keep the editor trialsTable template clean, only mutating the active queue
  playbackState.trialsQueue = JSON.parse(JSON.stringify(state.trialsTable));
  fillRandomMathInQueue();
  
  if (state.settings.randomizeTrials) {
    shuffleArray(playbackState.trialsQueue);
  }
  
  // Show active viewports
  document.getElementById("player-setup-box").style.display = "none";
  document.getElementById("player-viewport").style.display = "block";
  document.getElementById("player-hud").style.display = "flex";
  
  // Add keyboard response listener for player
  document.addEventListener("keydown", handlePlayerKeyDown);
  
  // Run first trial
  runCurrentTrial();
}

function fillRandomMathInQueue() {
  playbackState.trialsQueue.forEach(row => {
    // Generate for math_eq & math_ans if present and empty
    if ('math_eq' in row && (row['math_eq'] === "" || row['math_eq'] === undefined)) {
      const math = generateRandomMathEquation(false); // standard math
      row['math_eq'] = math.equation;
      row['math_ans'] = math.answer;
    }
    
    // Generate for dual_math & dual_math_ans if present and empty
    if ('dual_math' in row && (row['dual_math'] === "" || row['dual_math'] === undefined)) {
      const math = generateRandomMathEquation(true); // simpler math for dual task
      row['dual_math'] = math.equation;
      row['dual_math_ans'] = math.answer;
    }
  });
}

function generateRandomMathEquation(isSimpler) {
  const operators = isSimpler ? ["+", "-"] : ["+", "-", "*"];
  const op = operators[Math.floor(Math.random() * operators.length)];
  
  let num1, num2, equation, answer;
  
  if (op === "+") {
    num1 = Math.floor(Math.random() * 50) + 10; // 10-59
    num2 = Math.floor(Math.random() * 40) + 10; // 10-49
    equation = `${num1} + ${num2} = ?`;
    answer = String(num1 + num2);
  } else if (op === "-") {
    num1 = Math.floor(Math.random() * 60) + 30; // 30-89
    num2 = Math.floor(Math.random() * 20) + 10; // 10-29
    equation = `${num1} - ${num2} = ?`;
    answer = String(num1 - num2);
  } else {
    // Multiplication
    num1 = Math.floor(Math.random() * 10) + 3; // 3-12
    num2 = Math.floor(Math.random() * 8) + 3;  // 3-10
    equation = `${num1} * ${num2} = ?`;
    answer = String(num1 * num2);
  }
  
  return { equation, answer };
}

function runCurrentTrial() {
  // Cancel Speech Synthesis from previous trials
  window.speechSynthesis.cancel();

  if (playbackState.currentTrialIndex >= playbackState.trialsQueue.length) {
    finishExperimentPlayback();
    return;
  }
  
  // If it's not the first trial, skip the instructions slide if present
  if (playbackState.currentTrialIndex > 0 && state.slides[0] && (state.slides[0].id === "slide_instructions" || state.slides[0].id.includes("instructions"))) {
    playbackState.currentSlideIndex = 1;
  } else {
    playbackState.currentSlideIndex = 0;
  }
  
  playbackState.trialResponses = [];
  playbackState.trialStartTime = performance.now();
  
  updatePlayerHUD();
  renderPlayerSlide();
}

function renderPlayerSlide() {
  // Check slide bound
  if (playbackState.currentSlideIndex >= state.slides.length) {
    // Last slide passed -> end trial
    endActiveTrial(null, "finished_slides");
    return;
  }
  
  const slide = state.slides[playbackState.currentSlideIndex];
  playbackState.currentSlideId = slide.id;
  
  // Pre-fetch active trial data
  const currentTrialData = playbackState.trialsQueue[playbackState.currentTrialIndex];
  
  const viewport = document.getElementById("player-viewport");
  viewport.innerHTML = "";
  
  // Pre-compile timer offsets
  playbackState.slideStartTime = performance.now();
  
  // Render each element on viewport with dynamic properties replaced
  slide.elements.forEach(el => {
    const div = document.createElement("div");
    div.className = `canvas-element canvas-element-${el.type}`;
    
    // Position/dimensions
    div.style.left = `${el.left}px`;
    div.style.top = `${el.top}px`;
    div.style.width = `${el.width}px`;
    div.style.height = `${el.height}px`;
    
    // Resolve dynamic styling variables (e.g. {{color}})
    const colorVal = resolveVariables(el.color, currentTrialData) || "#ffffff";
    const bgVal = resolveVariables(el.backgroundColor, currentTrialData) || "transparent";
    const borderColVal = resolveVariables(el.borderColor, currentTrialData) || "transparent";
    
    div.style.color = colorVal;
    div.style.backgroundColor = bgVal;
    div.style.borderRadius = `${el.borderRadius || 0}px`;
    div.style.borderColor = borderColVal;
    div.style.borderWidth = `${el.borderWidth || 0}px`;
    div.style.borderStyle = el.borderWidth ? "solid" : "none";
    
    // Content values
    if (el.type === "text" || el.type === "fixation" || el.type === "button") {
      div.textContent = resolveVariables(el.text, currentTrialData);
      div.style.fontSize = `${el.fontSize || 18}px`;
    } 
    else if (el.type === "image") {
      const srcUrl = resolveVariables(el.src, currentTrialData);
      if (srcUrl) {
        div.style.backgroundImage = `url('${srcUrl}')`;
        div.classList.add("has-image");
      }
    }
    else if (el.type === "input") {
      const inputEl = document.createElement("input");
      inputEl.type = "text";
      inputEl.className = "player-text-input";
      inputEl.placeholder = "Nhập câu trả lời...";
      inputEl.style.width = "100%";
      inputEl.style.height = "100%";
      inputEl.style.background = "transparent";
      inputEl.style.border = "none";
      inputEl.style.color = "#ffffff";
      inputEl.style.fontFamily = "var(--font-sans)";
      inputEl.style.fontSize = "14px";
      inputEl.style.outline = "none";
      inputEl.style.paddingLeft = "10px";
      
      inputEl.onkeydown = (e) => {
        e.stopPropagation(); // Prevent global triggers
        if (e.key === "Enter") {
          const rawAns = inputEl.value.trim();
          handlePlayerResponse("keypress", el.id, { key: rawAns });
        }
      };
      
      div.appendChild(inputEl);
      
      // Auto-focus first input
      setTimeout(() => {
        if (inputEl.isConnected) inputEl.focus();
      }, 50);
    }
    else if (el.type === "choice") {
      div.style.flexDirection = "column";
      div.style.alignItems = "stretch";
      div.style.justifyContent = "center";
      div.style.padding = "8px";
      div.style.display = "flex";
      
      const qText = document.createElement("div");
      qText.style.fontSize = `${el.fontSize || 16}px`;
      qText.style.color = colorVal;
      qText.style.textAlign = "center";
      qText.style.marginBottom = "6px";
      qText.textContent = resolveVariables(el.text, currentTrialData) || "Câu hỏi trắc nghiệm?";
      div.appendChild(qText);
      
      const optsContainer = document.createElement("div");
      optsContainer.style.display = "flex";
      optsContainer.style.gap = "6px";
      optsContainer.style.justifyContent = "center";
      optsContainer.style.flexWrap = "wrap";
      
      const rawOptions = resolveVariables(el.options || "Có, Không", currentTrialData);
      const opts = rawOptions.split(",").map(o => o.trim());
      opts.forEach(opt => {
        const optBtn = document.createElement("button");
        optBtn.className = "choice-opt-btn";
        optBtn.style.padding = "5px 12px";
        optBtn.style.fontSize = "12px";
        optBtn.style.borderRadius = "4px";
        optBtn.style.border = "1px solid rgba(255,255,255,0.2)";
        optBtn.style.backgroundColor = "rgba(255,255,255,0.08)";
        optBtn.style.color = "#ffffff";
        optBtn.style.cursor = "pointer";
        optBtn.textContent = opt;
        
        optBtn.onclick = (e) => {
          e.stopPropagation();
          handlePlayerResponse("keypress", el.id, { key: opt });
        };
        optsContainer.appendChild(optBtn);
      });
      div.appendChild(optsContainer);
    }
    else if (el.type === "audio") {
      div.style.flexDirection = "row";
      div.style.gap = "10px";
      div.style.padding = "10px";
      div.style.display = "flex";
      div.style.alignItems = "center";
      div.style.justifyContent = "center";
      
      const icon = document.createElement("span");
      icon.style.fontSize = "24px";
      icon.textContent = "🔊";
      div.appendChild(icon);
      
      const details = document.createElement("div");
      details.style.display = "flex";
      details.style.flexDirection = "column";
      
      const title = document.createElement("span");
      title.style.fontSize = "11px";
      title.style.fontWeight = "700";
      title.style.color = "var(--primary-accent)";
      title.style.textTransform = "uppercase";
      title.textContent = "Âm thanh (TTS)";
      details.appendChild(title);
      
      const descText = document.createElement("span");
      descText.style.fontSize = `${el.fontSize || 13}px`;
      descText.style.color = el.color || "var(--text-primary)";
      descText.style.wordBreak = "break-all";
      descText.style.whiteSpace = "nowrap";
      descText.style.overflow = "hidden";
      descText.style.textOverflow = "ellipsis";
      descText.style.maxWidth = "130px";
      descText.textContent = resolveVariables(el.text, currentTrialData) || "Đoạn thuyết minh...";
      details.appendChild(descText);
      
      div.appendChild(details);
      
      // Trigger Speech Synthesis in Vietnamese
      const speakText = resolveVariables(el.text, currentTrialData);
      if (speakText) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(speakText);
        utterance.lang = "vi-VN";
        
        // Try to select a Vietnamese voice if populated
        const voices = window.speechSynthesis.getVoices();
        const viVoice = voices.find(voice => voice.lang.includes("vi") || voice.lang.includes("VI"));
        if (viVoice) {
          utterance.voice = viVoice;
        }
        
        window.speechSynthesis.speak(utterance);
      }
    }
    
    // Attach click events if click trigger is bound
    if (el.trigger && el.trigger.type === "click") {
      div.style.cursor = "pointer";
      div.onclick = (e) => {
        e.stopPropagation();
        handlePlayerResponse("click", el.id, e);
      };
    }
    
    viewport.appendChild(div);
  });
  
  // Setup slide timers / timeouts
  if (playbackState.activeTimerId) {
    clearTimeout(playbackState.activeTimerId);
    playbackState.activeTimerId = null;
  }
  
  // Check if any element has a timeout trigger
  const timeoutElement = slide.elements.find(el => el.trigger && el.trigger.type === "timeout");
  if (timeoutElement) {
    const delay = parseInt(resolveVariables(timeoutElement.trigger.duration, currentTrialData)) || 1000;
    playbackState.activeTimerId = setTimeout(() => {
      handlePlayerResponse("timeout", timeoutElement.id, null);
    }, delay);
  }
}

function handlePlayerResponse(type, elementId, eventData) {
  if (!playbackState.isActive) return;
  
  const slide = state.slides[playbackState.currentSlideIndex];
  const el = slide.elements.find(item => item.id === elementId);
  if (!el || !el.trigger) return;
  
  const trig = el.trigger;
  const currentTrialData = playbackState.trialsQueue[playbackState.currentTrialIndex];
  const responseTime = performance.now() - playbackState.slideStartTime;
  
  // Clear any running timers
  if (playbackState.activeTimerId) {
    clearTimeout(playbackState.activeTimerId);
    playbackState.activeTimerId = null;
  }
  
  let isCorrect = null;
  let responseVal = "";
  
  if (type === "click") {
    const inputs = document.querySelectorAll(".player-text-input");
    let typedVals = [];
    inputs.forEach(inp => typedVals.push(inp.value.trim()));
    
    const selectedChoice = playbackState.selectedChoiceVal || "";
    
    if (typedVals.length > 0 || selectedChoice !== "") {
      let parts = [];
      if (selectedChoice) parts.push(selectedChoice);
      if (typedVals.length > 0) parts.push(typedVals.join(", "));
      responseVal = parts.join(", ");
      
      playbackState.selectedChoiceVal = "";
      
      const targetVal = resolveVariables(trig.correctKey, currentTrialData) || "";
      if (targetVal !== "") {
        const lowerResp = responseVal.toLowerCase();
        const lowerTarget = targetVal.toLowerCase();
        
        if (lowerTarget.includes(",")) {
          const expectedParts = lowerTarget.split(",").map(p => p.trim());
          isCorrect = expectedParts.every(part => lowerResp.includes(part));
        } else {
          isCorrect = (lowerResp === lowerTarget);
        }
      } else {
        isCorrect = true;
      }
    } else {
      responseVal = `Click:${elementId}`;
      isCorrect = !!trig.recordCorrect;
    }
  } 
  else if (type === "keypress") {
    responseVal = eventData.key.toLowerCase();
    const targetKey = resolveVariables(trig.correctKey, currentTrialData);
    if (targetKey !== undefined && targetKey !== null && targetKey !== "") {
      isCorrect = (responseVal === targetKey.toLowerCase());
    } else {
      isCorrect = true; // default correct if no evaluation rule is set
    }
  } 
  else if (type === "timeout") {
    responseVal = "Timeout";
    // Check if correctKey was empty (e.g. No-Go condition where correct response is NOT responding)
    const targetKey = resolveVariables(trig.correctKey, currentTrialData);
    if (targetKey === "") {
      isCorrect = true;
    } else {
      isCorrect = false;
    }
  }
  
  // Log this response
  playbackState.trialResponses.push({
    slideIndex: playbackState.currentSlideIndex,
    slideName: slide.name,
    type: type,
    rt: responseTime,
    response: responseVal,
    correct: isCorrect
  });
  
  // Show quick HUD RT response
  document.getElementById("hud-last-rt").textContent = `${Math.round(responseTime)}ms`;
  
  // Visual accuracy feedback flash if configured
  if (trig.recordCorrect || (trig.type === "keypress" && trig.correctKey) || (trig.type === "timeout" && trig.correctKey !== undefined)) {
    flashPlayerFeedback(isCorrect);
  }
  
  // Decide next step based on action
  const action = trig.action || "next";
  if (action === "next") {
    playbackState.currentSlideIndex++;
    renderPlayerSlide();
  } 
  else if (action === "goto") {
    const nextIdx = state.slides.findIndex(s => s.id === trig.slideId);
    if (nextIdx !== -1) {
      playbackState.currentSlideIndex = nextIdx;
      renderPlayerSlide();
    } else {
      playbackState.currentSlideIndex++;
      renderPlayerSlide();
    }
  } 
  else if (action === "end") {
    endActiveTrial(responseTime, responseVal, isCorrect);
  }
}

function handlePlayerKeyDown(e) {
  if (!playbackState.isActive) return;
  
  // Prevent default scrolling for Spacebar during trials
  if (e.key === " ") {
    e.preventDefault();
  }
  
  const slide = state.slides[playbackState.currentSlideIndex];
  if (!slide) return;
  
  // Search for any element waiting for keypress
  const keypressElement = slide.elements.find(el => el.trigger && el.trigger.type === "keypress");
  if (keypressElement) {
    const trig = keypressElement.trigger;
    const currentTrialData = playbackState.trialsQueue[playbackState.currentTrialIndex];
    const allowedKeysStr = resolveVariables(trig.key, currentTrialData) || "";
    
    // Parse allowed keys
    const pressedKey = e.key.toLowerCase();
    
    if (allowedKeysStr === "") {
      // Any key is allowed
      handlePlayerResponse("keypress", keypressElement.id, e);
    } else {
      const allowedKeys = allowedKeysStr.split(",").map(k => k.trim().toLowerCase());
      if (allowedKeys.includes(pressedKey) || (allowedKeysStr === " " && e.key === " ")) {
        handlePlayerResponse("keypress", keypressElement.id, e);
      }
    }
  }
}

function flashPlayerFeedback(isCorrect) {
  const fb = document.getElementById("player-feedback");
  fb.className = "player-feedback-indicator";
  
  if (isCorrect) {
    fb.textContent = "Chính xác!";
    fb.classList.add("correct");
  } else {
    fb.textContent = "Sai!";
    fb.classList.add("incorrect");
  }
  
  setTimeout(() => {
    fb.className = "player-feedback-indicator";
  }, 400);
}

function endActiveTrial(finalRT, finalResponse, isCorrect) {
  // Aggregate trial metrics
  const trialNum = playbackState.currentTrialIndex + 1;
  const timestamp = new Date().toLocaleTimeString();
  
  const currentTrialData = playbackState.trialsQueue[playbackState.currentTrialIndex];
  
  // Find final keypress response or default to last logged response
  let rt = finalRT;
  let response = finalResponse;
  let correct = isCorrect;
  
  if (playbackState.trialResponses.length > 0) {
    // Extract last measured response from trials
    const lastResp = playbackState.trialResponses[playbackState.trialResponses.length - 1];
    if (rt === null || rt === undefined) {
      rt = lastResp.rt;
      response = lastResp.response;
      correct = lastResp.correct;
    }
  }
  
  if (rt === null || rt === undefined) {
    rt = 0;
    response = "No Response";
    correct = false;
  }
  
  playbackState.runTrialsLog.push({
    trialNum: trialNum,
    timestamp: timestamp,
    rt: Math.round(rt * 100) / 100, // round to 2 decimals
    response: response,
    correct: correct,
    variablesLoaded: { ...currentTrialData }
  });
  
  // Advance trial queue
  playbackState.currentTrialIndex++;
  runCurrentTrial();
}

function updatePlayerHUD() {
  document.getElementById("hud-trial-num").textContent = playbackState.currentTrialIndex + 1;
  document.getElementById("hud-trial-total").textContent = playbackState.trialsQueue.length;
  
  // HUD resolution timer simulator
  const start = performance.now();
  if (playbackState.hudTimerInterval) {
    clearInterval(playbackState.hudTimerInterval);
  }
  playbackState.hudTimerInterval = setInterval(() => {
    if (!playbackState.isActive) {
      clearInterval(playbackState.hudTimerInterval);
      return;
    }
    const current = performance.now();
    document.getElementById("hud-timer").textContent = `${(current - start).toFixed(4)} ms`;
  }, 100);
}

function saveResultToServer(runData) {
  fetch('/api/results', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(runData)
  })
  .then(r => r.json())
  .then(data => {
    console.log('Result saved to server successfully');
    if (!isParticipantOnly) {
      loadResultsFromServer();
    }
  })
  .catch(err => {
    console.warn('Could not save result to server:', err);
  });
}

function finishExperimentPlayback() {
  playbackState.isActive = false;
  document.removeEventListener("keydown", handlePlayerKeyDown);
  
  // Cancel Speech Synthesis
  window.speechSynthesis.cancel();
  
  if (playbackState.hudTimerInterval) {
    clearInterval(playbackState.hudTimerInterval);
  }
  
  // Compute final summary data
  const total = playbackState.runTrialsLog.length;
  const correctCount = playbackState.runTrialsLog.filter(t => t.correct).length;
  const accuracy = total > 0 ? Math.round((correctCount / total) * 100) : 0;
  
  const validRTs = playbackState.runTrialsLog.filter(t => t.correct && t.rt > 0).map(t => t.rt);
  const meanRT = validRTs.length > 0 ? Math.round(validRTs.reduce((a, b) => a + b, 0) / validRTs.length) : 0;
  
  const newRun = {
    id: "run_" + Date.now(),
    projectName: state.projectName,
    participant: playbackState.participant,
    timestamp: new Date().toLocaleString(),
    totalTrials: total,
    correctCount: correctCount,
    accuracy: accuracy,
    meanRT: meanRT,
    trials: playbackState.runTrialsLog
  };
  
  // Save to State
  state.results.unshift(newRun); // pre-pend to view latest first
  saveStateToLocalStorage();
  saveResultToServer(newRun);
  
  // Display player summary screen
  document.getElementById("player-viewport").style.display = "none";
  document.getElementById("player-hud").style.display = "none";
  document.getElementById("player-complete-box").style.display = "block";
  
  document.getElementById("player-res-accuracy").textContent = `${accuracy}%`;
  document.getElementById("player-res-rt").textContent = `${meanRT} ms`;
  
  if (isParticipantOnly) {
    const submitBtn = document.querySelector("#player-complete-box .player-setup-actions .btn-primary");
    if (submitBtn) {
      submitBtn.textContent = "Hoàn thành & Bắt đầu lượt mới";
      submitBtn.setAttribute("onclick", "location.reload()");
    }
  }
  
  // GSheet Sync Trigger
  const syncStatusPlayer = document.getElementById("player-sync-status");
  if (state.settings.autoSyncGSheet && state.settings.gsheetUrl) {
    syncStatusPlayer.style.display = "block";
    syncStatusPlayer.textContent = "🚀 Đang tự động gửi dữ liệu lên Google Sheets...";
    syncDataToGSheet(newRun)
      .then(success => {
        if (success) {
          syncStatusPlayer.textContent = "✅ Đồng bộ Google Sheets thành công!";
          syncStatusPlayer.style.color = "var(--accent-success)";
        } else {
          syncStatusPlayer.textContent = "❌ Đồng bộ Google Sheets thất bại. Vui lòng kiểm tra lại cấu hình.";
          syncStatusPlayer.style.color = "var(--accent-danger)";
        }
      });
  } else {
    syncStatusPlayer.style.display = "none";
  }
}

function closePlayerAndShowResults() {
  stopExperiment();
  switchTab("results");
}

// ===== 13. DATA ANALYTICS & PLOT DRAWING =====
function renderRunsHistory() {
  const container = document.getElementById("runs-history-list");
  container.innerHTML = "";
  
  if (state.results.length === 0) {
    container.innerHTML = `<p style="text-align:center;color:var(--text-muted);font-style:italic;padding:20px 0;">Chưa có lượt chạy thử nghiệm nào.</p>`;
    // Reset KPIs
    document.getElementById("kpi-accuracy").textContent = "--%";
    document.getElementById("kpi-mean-rt").textContent = "-- ms";
    document.getElementById("kpi-runs").textContent = "0";
    document.getElementById("kpi-trials-total").textContent = "0";
    return;
  }
  
  // Calculate average KPIs
  const totalRuns = state.results.length;
  const avgAccuracy = Math.round(state.results.reduce((a, b) => a + b.accuracy, 0) / totalRuns);
  const validRTs = state.results.map(r => r.meanRT).filter(rt => rt > 0);
  const avgRT = validRTs.length > 0 ? Math.round(validRTs.reduce((a, b) => a + b, 0) / validRTs.length) : 0;
  const totalTrials = state.results.reduce((a, b) => a + b.totalTrials, 0);
  
  document.getElementById("kpi-accuracy").textContent = `${avgAccuracy}%`;
  document.getElementById("kpi-mean-rt").textContent = `${avgRT} ms`;
  document.getElementById("kpi-runs").textContent = totalRuns;
  document.getElementById("kpi-trials-total").textContent = totalTrials;
  
  // Find active run in history selection (default to index 0 if not set)
  let activeRunId = getActiveRunId();
  
  state.results.forEach(run => {
    const isActive = run.id === activeRunId;
    const el = document.createElement("div");
    el.className = `history-item ${isActive ? 'active' : ''}`;
    el.onclick = () => selectActiveRun(run.id);
    
    el.innerHTML = `
      <div>
        <div class="history-user">${escapeHTML(run.participant)}</div>
        <div class="history-date">${run.timestamp}</div>
      </div>
      <div class="history-metrics">
        <div class="history-acc">${run.accuracy}% đúng</div>
        <div class="history-rt">${run.meanRT} ms</div>
      </div>
    `;
    container.appendChild(el);
  });
}

let _activeRunIdOverride = null;
function getActiveRunId() {
  if (_activeRunIdOverride) return _activeRunIdOverride;
  if (state.results.length > 0) return state.results[0].id;
  return null;
}

function selectActiveRun(runId) {
  _activeRunIdOverride = runId;
  renderRunsHistory();
  renderResultsTable();
  drawAnalyticsChart();
}

function renderResultsTable() {
  const body = document.getElementById("results-body");
  body.innerHTML = "";
  
  const activeRunId = getActiveRunId();
  const run = state.results.find(r => r.id === activeRunId);
  
  if (!run || !run.trials || run.trials.length === 0) {
    body.innerHTML = `<tr><td colspan="8" class="empty-table-placeholder">Hãy chọn một lượt chơi ở trên để xem chi tiết từng trial.</td></tr>`;
    return;
  }
  
  run.trials.forEach(t => {
    const tr = document.createElement("tr");
    
    const accClass = t.correct ? "legend-color correct" : "legend-color incorrect";
    const accText = t.correct ? "Đúng" : (t.response === "Timeout" ? "Hết giờ" : "Sai");
    
    // Convert variables loaded to a readable line
    let varsText = "";
    if (t.variablesLoaded) {
      varsText = Object.entries(t.variablesLoaded).map(([k, v]) => `${k}:${v}`).join(", ");
    }
    
    tr.innerHTML = `
      <td style="font-weight:600;">${escapeHTML(run.participant)}</td>
      <td style="text-align:center;font-weight:700;">${t.trialNum}</td>
      <td style="font-size:11.5px;color:var(--text-muted);">${t.timestamp}</td>
      <td style="font-family:var(--font-mono);font-weight:600;text-align:center;">${escapeHTML(t.response)}</td>
      <td style="font-family:var(--font-mono);color:var(--secondary-accent);text-align:center;">${escapeHTML(t.variablesLoaded.correct_key || t.variablesLoaded.correctKey || "—")}</td>
      <td>
        <div style="display:flex;align-items:center;gap:6px;font-weight:600;color:${t.correct ? 'var(--accent-success)' : 'var(--accent-danger)'}">
          <span class="${accClass}"></span>
          ${accText}
        </div>
      </td>
      <td style="font-family:var(--font-mono);font-weight:700;color:var(--primary-accent-light);text-align:center;">${t.rt ? t.rt + ' ms' : '—'}</td>
      <td style="font-size:12px;color:var(--text-secondary);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHTML(varsText)}">${escapeHTML(varsText)}</td>
    `;
    body.appendChild(tr);
  });
}

function clearAllResultsData() {
  if (confirm("Bạn có chắc chắn muốn xóa toàn bộ dữ liệu kết quả nghiên cứu đã thu thập? Thao tác này không thể hoàn tác.")) {
    state.results = [];
    _activeRunIdOverride = null;
    saveStateToLocalStorage();
    renderRunsHistory();
    renderResultsTable();
    drawAnalyticsChart();
    
    // Clear results on the server
    fetch('/api/clear-results', { method: 'POST' })
      .then(() => {
        console.log('Server results cleared');
        showNotification("Đã xóa toàn bộ lịch sử thử nghiệm trên cả máy chủ và trình duyệt");
      })
      .catch(err => {
        console.warn('Could not clear results on server:', err);
        showNotification("Đã xóa lịch sử cục bộ, nhưng gặp lỗi khi xóa trên máy chủ.");
      });
  }
}

// Draw a beautiful glowing distribution plot on canvas
function drawAnalyticsChart() {
  const canvas = document.getElementById("rt-distribution-chart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  
  const activeRunId = getActiveRunId();
  const run = state.results.find(r => r.id === activeRunId);
  
  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  if (!run || !run.trials || run.trials.length === 0) {
    ctx.fillStyle = "#64748b";
    ctx.font = "italic 14px Outfit";
    ctx.textAlign = "center";
    ctx.fillText("Chưa có dữ liệu vẽ biểu đồ phân phối", canvas.width / 2, canvas.height / 2);
    return;
  }
  
  const trials = run.trials;
  
  // Set up chart dimensions
  const padding = { top: 30, right: 30, bottom: 45, left: 50 };
  const chartW = canvas.width - padding.left - padding.right;
  const chartH = canvas.height - padding.top - padding.bottom;
  
  // Draw grid lines
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 1;
  const gridLines = 4;
  for (let i = 0; i <= gridLines; i++) {
    const y = padding.top + (chartH / gridLines) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(canvas.width - padding.right, y);
    ctx.stroke();
  }
  
  // Calculate limits (reaction time distribution bounds)
  const rts = trials.map(t => t.rt).filter(rt => rt > 0);
  const minRT = rts.length > 0 ? Math.min(...rts) : 0;
  const maxRT = rts.length > 0 ? Math.max(...rts) : 1000;
  
  const minVal = Math.max(0, Math.floor(minRT / 100) * 100 - 100);
  const maxVal = Math.ceil(maxRT / 100) * 100 + 100;
  
  // Draw X/Y labels
  ctx.fillStyle = "#94a3b8";
  ctx.font = "600 11px Outfit";
  ctx.textAlign = "right";
  
  // Y-axis labels (trial counts / percentages)
  for (let i = 0; i <= gridLines; i++) {
    const y = padding.top + chartH - (chartH / gridLines) * i;
    const labelVal = Math.round((trials.length / gridLines) * i);
    ctx.fillText(labelVal, padding.left - 10, y + 4);
  }
  
  // Draw bars
  // Group into bins (e.g. 5 bins)
  const numBins = 7;
  const binWidthVal = (maxVal - minVal) / numBins;
  const bins = Array(numBins).fill(0).map(() => ({ correct: 0, incorrect: 0 }));
  
  trials.forEach(t => {
    if (t.rt <= 0) return; // ignore no responses
    let binIdx = Math.floor((t.rt - minVal) / binWidthVal);
    binIdx = Math.max(0, Math.min(numBins - 1, binIdx));
    if (t.correct) {
      bins[binIdx].correct++;
    } else {
      bins[binIdx].incorrect++;
    }
  });
  
  // Draw X labels
  ctx.textAlign = "center";
  for (let i = 0; i <= numBins; i++) {
    const x = padding.left + (chartW / numBins) * i;
    const labelVal = Math.round(minVal + binWidthVal * i);
    ctx.fillText(`${labelVal}ms`, x, padding.top + chartH + 20);
  }
  
  // Find max count in any bin to scale height
  const maxCount = Math.max(...bins.map(b => b.correct + b.incorrect), 1);
  const barW = (chartW / numBins) * 0.6; // 60% of bin width
  
  bins.forEach((bin, idx) => {
    if (bin.correct === 0 && bin.incorrect === 0) return;
    
    const x = padding.left + (chartW / numBins) * idx + (chartW / numBins) / 2 - barW / 2;
    
    const hCorrect = (bin.correct / maxCount) * chartH;
    const hIncorrect = (bin.incorrect / maxCount) * chartH;
    
    // Draw Correct responses (Emerald bar)
    if (hCorrect > 0) {
      ctx.fillStyle = "rgba(16, 185, 129, 0.75)";
      ctx.shadowColor = "rgba(16, 185, 129, 0.4)";
      ctx.shadowBlur = 8;
      ctx.fillRect(x, padding.top + chartH - hCorrect, barW, hCorrect);
    }
    
    // Draw Incorrect responses stacked (Crimson bar)
    if (hIncorrect > 0) {
      ctx.fillStyle = "rgba(239, 68, 68, 0.75)";
      ctx.shadowColor = "rgba(239, 68, 68, 0.4)";
      ctx.shadowBlur = 8;
      ctx.fillRect(x, padding.top + chartH - hCorrect - hIncorrect, barW, hIncorrect);
    }
    
    // Reset shadow
    ctx.shadowBlur = 0;
  });
  
  // Draw axis lines
  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  // Y Axis
  ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, padding.top + chartH);
  // X Axis
  ctx.lineTo(canvas.width - padding.right, padding.top + chartH);
  ctx.stroke();
}

function exportDataToCSV() {
  const activeRunId = getActiveRunId();
  const run = state.results.find(r => r.id === activeRunId);
  
  if (!run || !run.trials || run.trials.length === 0) {
    showNotification("Chưa có dữ liệu để xuất file CSV!", "danger");
    return;
  }
  
  // Define CSV columns
  // headers: Project, Participant, TrialNum, Timestamp, Response, CorrectKey, Accuracy, ReactionTime_ms, Custom Variables
  const csvHeaders = ["ProjectName", "ParticipantCode", "TrialNum", "Timestamp", "Response", "CorrectKey", "Accuracy", "ReactionTime_ms"];
  
  // Add all experiment variable names as columns
  const allVars = state.variables;
  const headers = [...csvHeaders, ...allVars];
  
  let csvContent = "\uFEFF"; // Add BOM for excel Vietnamese characters support
  csvContent += headers.join(",") + "\n";
  
  run.trials.forEach(t => {
    const accuracy = t.correct ? "1" : "0";
    const rt = t.rt ? t.rt : "";
    const correctKey = t.variablesLoaded.correct_key || t.variablesLoaded.correctKey || "";
    
    let rowData = [
      escapeCSV(run.projectName),
      escapeCSV(run.participant),
      t.trialNum,
      t.timestamp,
      escapeCSV(t.response),
      escapeCSV(correctKey),
      accuracy,
      rt
    ];
    
    // Append variables value
    allVars.forEach(v => {
      const val = t.variablesLoaded[v] !== undefined ? t.variablesLoaded[v] : "";
      rowData.push(escapeCSV(String(val)));
    });
    
    csvContent += rowData.join(",") + "\n";
  });
  
  // Create download link
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `IPI_TEST_Results_${run.participant}_${Date.now()}.csv`);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  showNotification("Đã tải tệp CSV kết quả thành công!");
}

function escapeCSV(val) {
  if (val.includes(",") || val.includes("\"") || val.includes("\n")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

// ===== 14. GOOGLE SHEETS WEBHOOK SYNC INTEGRATION =====
function syncDataToGSheet(runData) {
  if (!state.settings.gsheetUrl) {
    return Promise.resolve(false);
  }
  
  // Prepare payload
  const payload = {
    projectName: runData.projectName,
    participant: runData.participant,
    timestamp: runData.timestamp,
    totalTrials: runData.totalTrials,
    correctCount: runData.correctCount,
    accuracy: runData.accuracy,
    meanRT: runData.meanRT,
    trials: runData.trials.map(t => ({
      trialNum: t.trialNum,
      rt: t.rt,
      response: t.response,
      correct: t.correct,
      vars: t.variablesLoaded
    }))
  };
  
  // Send POST request (use no-cors mode to handle Google Apps Script redirect cleanly)
  return fetch(state.settings.gsheetUrl, {
    method: "POST",
    mode: "no-cors",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  })
  .then(() => {
    // Since 'no-cors' yields opaque response, we assume success if it doesn't throw
    console.log("Dữ liệu đã được gửi thành công đến Google Sheet Webhook");
    return true;
  })
  .catch(err => {
    console.error("Đồng bộ Google Sheets lỗi:", err);
    return false;
  });
}

function testGSheetConnection() {
  if (!state.settings.gsheetUrl) {
    showNotification("Vui lòng điền Webhook URL trước!", "danger");
    return;
  }
  
  showNotification("Đang kiểm tra kết nối...");
  
  // Send test payload
  const testPayload = {
    projectName: "IPI TEST Studio Connection Test",
    participant: "TEST_RUNNER",
    totalTrials: 1,
    correctCount: 1,
    accuracy: 100,
    meanRT: 250.0,
    trials: [{ trialNum: 1, rt: 250, response: "test", correct: true, variablesLoaded: { test: "success" } }]
  };
  
  fetch(state.settings.gsheetUrl, {
    method: "POST",
    mode: "no-cors",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(testPayload)
  })
  .then(() => {
    showNotification("Kết nối kiểm tra thành công! Một dòng kiểm tra đã được gửi lên Sheet của bạn.");
  })
  .catch(err => {
    showNotification("Kết nối thất bại. Hãy kiểm tra URL hoặc CORS.", "danger");
  });
}

function syncResultsToGSheetManual() {
  const activeRunId = getActiveRunId();
  const run = state.results.find(r => r.id === activeRunId);
  
  if (!run) {
    showNotification("Không tìm thấy kết quả để đồng bộ!", "danger");
    return;
  }
  
  if (!state.settings.gsheetUrl) {
    showNotification("Vui lòng điền và cấu hình URL Google Sheets Webhook ở tab cài đặt!", "danger");
    switchTab("gsheet");
    return;
  }
  
  showNotification("Đang đồng bộ dữ liệu...");
  
  syncDataToGSheet(run)
    .then(success => {
      if (success) {
        showNotification("Đồng bộ dữ liệu lên Google Sheets thành công!");
      } else {
        showNotification("Đồng bộ thất bại. Vui lòng kiểm tra lại Deployment Web App URL.", "danger");
      }
    });
}

// ===== 15. UTILITIES / HELPERS =====
function resolveVariables(str, dataContext) {
  if (typeof str !== "string") return str;
  if (!dataContext) return str;
  
  // Replace all {{variable}} occurrences with current context values
  return str.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    key = key.trim();
    if (dataContext[key] !== undefined) {
      return dataContext[key];
    }
    return match; // return original if not found
  });
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

function escapeHTML(str) {
  return (str || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function copyAppsScriptCode() {
  const code = document.getElementById("apps-script-code").textContent;
  navigator.clipboard.writeText(code).then(() => {
    showNotification("Đã sao chép mã Apps Script vào Clipboard!");
  }).catch(() => {
    showNotification("Không thể tự động sao chép. Vui lòng chọn thủ công.", "danger");
  });
}

function openTemplatesModal() {
  document.getElementById("modal-templates").classList.add("open");
}

function closeTemplatesModal() {
  document.getElementById("modal-templates").classList.remove("open");
}
