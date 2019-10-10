WebFont.load({
    google: {
        families: ["Open Sans:300,300italic,400,400italic,600,600italic,700,700italic,800,800italic", "Lato:100,100italic,300,300italic,400,400italic,700,700italic,900,900italic", "Merriweather:300,300italic,400,400italic,700,700italic,900,900italic", "Poppins:300,regular,500,600,700:latin-ext,latin", "Oswald:400,700:latin-ext,latin"]
    }
});

! function(o, c) {
    var n = c.documentElement,
        t = " w-mod-";
    n.className += t + "js", ("ontouchstart" in o || o.DocumentTouch && c instanceof DocumentTouch) && (n.className += t + "touch")
}(window, document);