/* Shared by every page: the theme toggle and reveal-on-scroll. */

(function () {
  const root = document.documentElement;
  const KEY = "s1x-theme";

  function stored() {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  }
  const saved = stored();
  if (saved === "light" || saved === "dark") root.dataset.theme = saved;

  function current() {
    if (root.dataset.theme) return root.dataset.theme;
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  document.addEventListener("DOMContentLoaded", () => {
    for (const btn of document.querySelectorAll(".theme-toggle")) {
      const label = () => btn.setAttribute("aria-label", `Switch to ${current() === "dark" ? "light" : "dark"} theme`);
      label();
      btn.addEventListener("click", () => {
        root.dataset.theme = current() === "dark" ? "light" : "dark";
        try {
          localStorage.setItem(KEY, root.dataset.theme);
        } catch {
          /* private window: the choice lasts for this page only */
        }
        label();
        document.dispatchEvent(new CustomEvent("themechange"));
      });
    }

    const els = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    els.forEach((el) => io.observe(el));
  });
})();
