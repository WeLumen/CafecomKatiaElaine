(() => {
  const dialog = document.getElementById("checkin-dialog");
  const fileInput = document.getElementById("checkin-file");
  const importPanel = document.getElementById("checkin-import");
  const search = document.getElementById("checkin-search");
  const roster = document.getElementById("checkin-roster");
  const count = document.getElementById("checkin-count");
  const list = document.getElementById("checkin-list");
  const message = document.getElementById("checkin-message");
  let names = [];
  let storageKey;
  let restoring;
  const alphabetical = new Intl.Collator("pt-BR", { sensitivity: "base" });

  const normalize = (text) =>
    text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

  async function savedRoster(value) {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("cafe-checkin-2026", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("recepcao");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction("recepcao", value ? "readwrite" : "readonly");
        const store = transaction.objectStore("recepcao");
        const request = value ? store.put(value, "lista") : store.get("lista");
        transaction.oncomplete = () => resolve(request.result);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      db.close();
    }
  }

  async function readNames(data) {
    const { getDocument, GlobalWorkerOptions } = await import("./assets/pdfjs/pdf.min.mjs");
    GlobalWorkerOptions.workerSrc = new URL("./assets/pdfjs/pdf.worker.min.mjs", document.baseURI).href;
    const loading = getDocument({ data, isEvalSupported: false, useSystemFonts: false });
    try {
      const pdf = await loading.promise;
      const result = [];
      for (let number = 1; number <= pdf.numPages; number++) {
        const page = await pdf.getPage(number);
        const { items } = await page.getTextContent();
        const entries = items.filter((item) => item.str?.trim());
        const header = entries.find((item) => normalize(item.str) === "nome");
        if (!header) throw new Error("Coluna Nome ausente");
        const [, , , , x, y] = header.transform;
        const rows = entries
          .filter((item) => Math.abs(item.transform[4] - x) < 1.5 && item.transform[5] < y - 4)
          .sort((a, b) => b.transform[5] - a.transform[5]);
        result.push(...rows.map((item) => item.str.trim()));
      }
      return result;
    } finally {
      await loading.destroy();
    }
  }

  function render() {
    const query = normalize(search.value);
    let present = 0;
    const rows = document.createDocumentFragment();
    const orderedNames = names.map((name, index) => ({ name, index }));
    orderedNames.sort((a, b) => alphabetical.compare(a.name, b.name));
    orderedNames.forEach(({ name, index }) => {
      const key = `${storageKey}:${index}`;
      const checked = localStorage.getItem(key) === "1";
      present += Number(checked);
      if (!normalize(name).includes(query)) return;
      const row = document.createElement("li");
      row.className = "checkin-row";
      const label = document.createElement("span");
      label.textContent = name;
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.index = index;
      button.setAttribute("aria-pressed", String(checked));
      button.setAttribute("aria-label", `Presença de ${name}`);
      button.textContent = checked ? "Presença confirmada" : "Confirmar presença";
      row.append(label, button);
      rows.append(row);
    });
    if (!rows.childElementCount) {
      const empty = document.createElement("li");
      empty.textContent = "Nenhum inscrito encontrado.";
      rows.append(empty);
    }
    list.replaceChildren(rows);
    count.textContent = `${present} de ${names.length} presenças confirmadas`;
  }

  function showRoster(saved) {
    localStorage.getItem(saved.storageKey);
    names = saved.names;
    storageKey = saved.storageKey;
    search.value = "";
    render();
    roster.hidden = false;
    importPanel.open = false;
    message.textContent = "";
    if (dialog.open) search.focus();
  }

  document.getElementById("checkin-open").addEventListener("click", () => {
    dialog.showModal();
    if (storageKey || restoring || fileInput.disabled) return;
    restoring = true;
    fileInput.disabled = true;
    message.textContent = "Buscando a lista salva…";
    savedRoster()
      .then((saved) => {
        if (saved) showRoster(saved);
        else message.textContent = "Selecione o PDF uma vez para preparar a recepção.";
      })
      .catch(() => {
        message.textContent = "Não foi possível acessar a lista salva neste navegador.";
      })
      .finally(() => {
        restoring = false;
        fileInput.disabled = false;
      });
  });
  search.addEventListener("input", render);

  fileInput.addEventListener("change", async () => {
    const [file] = fileInput.files;
    if (!file) return;
    fileInput.disabled = true;
    message.textContent = "Lendo a lista de inscritos…";
    try {
      if (location.protocol === "file:") {
        message.textContent = "Abra a página no site do evento ou em um servidor local para importar o PDF.";
        return;
      }
      const data = new Uint8Array(await file.arrayBuffer());
      const digest = await crypto.subtle.digest("SHA-256", data);
      const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      const importedNames = await readNames(data);
      if (!importedNames.length) throw new Error("Lista vazia");
      const saved = { pdf: file, names: importedNames, storageKey: `cafe-checkin-2026:${hash}` };
      await savedRoster(saved);
      showRoster(saved);
    } catch {
      message.textContent = "Não foi possível importar a lista. Selecione o PDF de respostas com a coluna Nome e verifique se o navegador permite o armazenamento local.";
    } finally {
      fileInput.disabled = false;
      fileInput.value = "";
    }
  });

  list.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-index]");
    if (!button) return;
    const key = `${storageKey}:${button.dataset.index}`;
    try {
      if (localStorage.getItem(key) === "1") localStorage.removeItem(key);
      else localStorage.setItem(key, "1");
      render();
      list.querySelector(`button[data-index="${button.dataset.index}"]`)?.focus();
      message.textContent = "";
    } catch {
      message.textContent = "Não foi possível salvar a presença neste navegador.";
    }
  });

  window.addEventListener("storage", (event) => {
    if (storageKey && (event.key === null || event.key.startsWith(`${storageKey}:`))) render();
  });
})();
