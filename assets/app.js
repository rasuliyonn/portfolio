const GITHUB_USER = "rasuliyonn";
const grid = document.querySelector("#work-grid");
const filters = document.querySelector("#filters");

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

function card(project, index) {
  const meta = [];
  if (project.language) {
    meta.push(
      `<span><span class="dot" aria-hidden="true"></span>${escapeHtml(project.language)}</span>`,
    );
  }
  meta.push(`<span>${project.tests} tests</span>`);
  meta.push(`<span>${project.deps === 0 ? "0 deps" : `${project.deps} deps`}</span>`);

  return `
    <article class="card" data-kind="${escapeHtml(project.kind)}" data-reveal>
      <div class="card-top">
        <span class="card-kind">${escapeHtml(project.kind)}</span>
        <span class="card-index">${String(index + 1).padStart(2, "0")} / ${escapeHtml(project.year)}</span>
      </div>
      <h3>${escapeHtml(project.name)}</h3>
      <p class="card-tagline">${escapeHtml(project.tagline)}</p>
      <p class="card-summary">${escapeHtml(project.summary)}</p>
      <ul class="card-tags">
        ${project.stack.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
      <div class="card-foot">
        <div>${meta.join("")}</div>
        <div class="card-links">
          <a href="${escapeHtml(project.href)}">Case study</a>
          <a href="${escapeHtml(project.repoUrl)}" aria-label="${escapeHtml(project.name)} on GitHub">GitHub ↗</a>
        </div>
      </div>
    </article>
  `;
}

function render(projects) {
  grid.innerHTML = projects.map(card).join("");
  grid.querySelectorAll(".card").forEach((element, index) => {
    element.style.transitionDelay = `${Math.min(index * 60, 300)}ms`;
  });
  observeReveals();
  const active = filters?.querySelector(".is-active")?.dataset.filter || "all";
  applyFilter(active, false);
}

function applyFilter(kind, updateButtons = true) {
  if (updateButtons) {
    filters.querySelectorAll(".filter").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.filter === kind);
    });
  }
  grid.querySelectorAll(".card").forEach((cardElement) => {
    const matches = kind === "all" || cardElement.dataset.kind === kind;
    cardElement.classList.toggle("is-hidden", !matches);
  });
}

function observeReveals() {
  const nodes = document.querySelectorAll("[data-reveal]:not(.is-visible)");
  if (!("IntersectionObserver" in window)) {
    nodes.forEach((node) => node.classList.add("is-visible"));
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
  );
  nodes.forEach((node) => observer.observe(node));
}

async function enrich(projects) {
  try {
    const response = await fetch(
      `https://api.github.com/users/${GITHUB_USER}/repos?per_page=100&sort=updated`,
      { headers: { Accept: "application/vnd.github+json" } },
    );
    if (!response.ok) return projects;
    const repos = await response.json();
    const byName = new Map(repos.map((repo) => [repo.name, repo]));
    return projects.map((project) => ({
      ...project,
      language: byName.get(project.repo)?.language || project.language,
      stars: byName.get(project.repo)?.stargazers_count ?? 0,
    }));
  } catch {
    return projects;
  }
}

/* ---------- decorative hero field ---------- */

function startHeroField() {
  const canvas = document.querySelector("#hero-canvas");
  if (!canvas) return;
  const context = canvas.getContext("2d");
  if (!context) return;

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sites = [
    { x: 0.16, y: 0.32 },
    { x: 0.46, y: 0.24 },
    { x: 0.78, y: 0.36 },
    { x: 0.3, y: 0.72 },
    { x: 0.6, y: 0.68 },
    { x: 0.9, y: 0.8 },
  ];
  const colors = ["#0b1220", "#243449", "#6b5b34", "#2d6d59", "#41a884", "#6ee7b7"];
  const columns = 48;
  const rows = 24;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = 360 * dpr;
  canvas.height = 180 * dpr;
  context.scale(dpr, dpr);

  let visible = true;
  let last = 0;

  function draw(time) {
    if (!visible) return;
    if (time - last < 90) {
      requestAnimationFrame(draw);
      return;
    }
    last = time;
    const phase = reduced ? 0 : time / 2600;
    const cellWidth = 360 / columns;
    const cellHeight = 180 / rows;

    for (let column = 0; column < columns; column += 1) {
      for (let row = 0; row < rows; row += 1) {
        const nx = (column + 0.5) / columns;
        const ny = (row + 0.5) / rows;
        const distances = sites
          .map((site, index) => {
            const x = Math.hypot(nx - (site.x + 0.015 * Math.sin(phase + index)), ny - site.y);
            return Math.hypot(x, (ny - site.y) * 0.2) + 0.026;
          })
          .sort((a, b) => a - b);
        const ratio = distances[1] / distances[0];
        const quality = 20 * Math.log10(ratio);
        const bucket = quality > 11 ? 5 : quality > 7 ? 4 : quality > 3 ? 3 : quality > 0 ? 2 : 1;
        context.fillStyle = colors[bucket];
        context.fillRect(column * cellWidth, row * cellHeight, cellWidth + 0.6, cellHeight + 0.6);
      }
    }

    context.fillStyle = "#e9eff9";
    for (const site of sites) {
      context.beginPath();
      context.arc(site.x * 360, site.y * 180, 2.6, 0, Math.PI * 2);
      context.fill();
    }
    if (!reduced) requestAnimationFrame(draw);
  }

  if ("IntersectionObserver" in window) {
    new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
      if (visible && !reduced) requestAnimationFrame(draw);
    }).observe(canvas);
  }
  draw(0);
}

/* ---------- boot ---------- */

async function boot() {
  try {
    const response = await fetch("data/projects.json");
    if (!response.ok) throw new Error("project data unavailable");
    const projects = await response.json();
    render(await enrich(projects));
  } catch (error) {
    grid.innerHTML =
      '<p>Project data could not be loaded. Browse the repositories on <a href="https://github.com/rasuliyonn">GitHub</a>.</p>';
  }

  filters?.addEventListener("click", (event) => {
    const button = event.target.closest(".filter");
    if (button) applyFilter(button.dataset.filter);
  });

  observeReveals();
  startHeroField();
}

boot();
