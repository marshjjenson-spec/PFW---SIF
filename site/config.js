// PFW-SIF site settings. This file is public; it only contains read-only values.
window.PFW_CONFIG = {
  // Supabase project URL and its publishable (read-only) key.
  supabaseUrl: "https://xiexkzzmntcojnsorbyd.supabase.co",
  supabaseKey: "sb_publishable_inCRNc5nvgYucRDVDtaowQ_N3sMI1zn",

  // Where the PFW-SIF logo links to, and the Apply button (leave applyUrl empty to hide it).
  homeUrl: "/",
  applyUrl: "",

  // Optional: an email address for membership questions. Shown on the Join page when applyUrl is empty.
  contactEmail: "",

  // Tabs across the top of every page. The current page is highlighted automatically.
  // Add your other pages here as they go live, e.g. { label: "About", href: "/about" }.
  nav: [
    { label: "Performance", href: "/" },
    { label: "Holdings", href: "/holdings" },
    { label: "Research", href: "/research" },
    { label: "Quarterly", href: "/quarterly" },
    { label: "Process", href: "/process" },
    { label: "Team", href: "/team" },
    { label: "About", href: "/about" },
    { label: "Join", href: "/join" }
  ]
};
