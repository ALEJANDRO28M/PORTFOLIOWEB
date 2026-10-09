// Animaciones al hacer scroll
if (window.AOS) AOS.init({ duration: 700, once: true, offset: 60 });

// Header con fondo al hacer scroll
const header = document.getElementById("header");
const onScroll = () => header.classList.toggle("scrolled", window.scrollY > 20);
window.addEventListener("scroll", onScroll);
onScroll();

// Menú móvil
const toggle = document.getElementById("menuToggle");
const nav = document.getElementById("nav");
const setMenu = (open) => {
  nav.classList.toggle("open", open);
  header.classList.toggle("menu-open", open);
  toggle.setAttribute("aria-expanded", open);
};
toggle.addEventListener("click", () => setMenu(!nav.classList.contains("open")));
nav.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => setMenu(false)));

// Año del footer
document.getElementById("year").textContent = new Date().getFullYear();
