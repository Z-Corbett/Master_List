!function(e,i,t,s){var h=i("html"),a=i(e),n={init:function(t,e){return this.options=i.extend({},this.options,t),this.elem=e,this.$elem=i(e),this._siteLayout=i("body").attr("data-sc-layout"),this._isCarousel=this.$elem.hasClass("hasCarousel"),this._isBottomNav="j"===this._siteLayout||"k"===this._siteLayout,this._isSideThumbs=this.$elem.hasClass("hasThumbs--left")||this.$elem.hasClass("hasThumbs--right"),this._usingImgShape=this.$elem.hasClass("circleImages")||this.$elem.hasClass("squareImages"),this._setHeightTargets(),this.$blockImg=this.$elem.find(".blockImg"),this.$blockWrap=this.$elem.closest(".blockContainer"),this.$slider=this.$elem.find(".flexslider"),this._isSideThumbs&&(this.$thumbsContainer=this.$elem.find(".thumbsContainer")),this.options.iPadHelper?this._iPadHelper():this._shouldRun()&&this._set(),this._bindHandlers(),this},options:{iPadHelper:!1},_eventNamespace:".fitToWindowGallery",_shouldRun:function(){var t=!1;return a.width()<768?!1===this._isBottomNav&&(t=!0):!1===h.hasClass("tuckContent")&&(t=!0),t},_setHeightTargets:function(){this._isCarousel?this.$heightTargets=this.$elem.find(".carousel-slide .contentImg"):this.$heightTargets=this.$elem.find(".flexMain .slides li"),this._usingImgShape&&(this.$imgShapes=this.$elem.parent().find(".carousel-slide .imgShape, .flexMain .imgShape"))},_bindHandlers:function(){var e=this;a.on("resize"+this._eventNamespace,i.debounce(250,function(){e._shouldRun()?e._set():e._unset()}));var t=i(".navContainer").length?"mobileNavBuilt"+this._eventNamespace+", mobileNavDestroyed"+this._eventNamespace:"enteredLargeScreenMode"+this._eventNamespace+", enteredSmallScreenMode"+this._eventNamespace;i("body").on(t+" , cssUpdated"+this._eventNamespace,function(t){e._shouldRun()?(e._set(),e._isCarousel&&-1<t.type.indexOf("mobileNav")&&e.$elem.find(".carousel").data("scCarousel").goTo(0)):e._unset()})},_unbindHandlers:function(){a.off(this._eventNamespace),i("body").off(this._eventNamespace)},_set:function(){i(".primaryAndSecondaryContainer").css("padding-top",0),this._unsetHeights(),this._setHeights(),this.$slider.length&&this.$slider.trigger("adjustSliderHeight"),this._isCarousel&&this.$elem.find(".carousel").data("scCarousel").refresh()},_unset:function(){this._unsetHeights(),this.$slider.length&&this.$slider.trigger("adjustSliderHeight")},_unsetHeights:function(){this.$heightTargets.css("height",""),this._usingImgShape&&this.$imgShapes.css("width",""),this._isSideThumbs&&this.$thumbsContainer.css("width",""),this.$blockImg.css({height:"",minHeight:""})},_setHeights:function(){var t=this.$heightTargets.first().outerHeight(),e=this._getSubtractions();this.$heightTargets.css("height",t-e),this._usingImgShape&&this.$imgShapes.css("width",t-e),this._isSideThumbs&&0<this.$thumbsContainer.outerWidth()-e&&this.$thumbsContainer.css("width",this.$thumbsContainer.outerWidth()-e),this.$blockImg.css({height:"auto",minHeight:0})},_iPadHelper:function(){var t=0===e.orientation||180===e.orientation?screen.height:screen.width;this.$heightTargets.css("max-height",t),this._usingImgShape&&this.$imgShapes.css("max-width",t),this._isSideThumbs&&this.$thumbsContainer.css("max-width",t),this.$blockImg.css({maxHeight:t})},_getSubtractions:function(){var s=0,t=[".mfItem"];return this._getSubtractionElems(t),i.each(t,function(t,e){s+=i(e).outerHeight()}),s+=this._getBlockSubtractions(),/iPhone|iPod/.test(navigator.userAgent)&&!e.MSStream&&(s+=69),/iPad/.test(navigator.userAgent)&&!e.MSStream&&(s+=24),s},_getBlockSubtractions:function(){var t=0;return t+=parseInt(this.$elem.css("border-top-width"),10),t+=parseInt(this.$elem.css("padding-top"),10),t+=parseInt(this.$blockWrap.css("border-top-width"),10),t+=parseInt(this.$blockWrap.css("padding-top"),10)},_getSubtractionElems:function(t){"a"===this._siteLayout||"g"===this._siteLayout||"i"===this._siteLayout||"j"===this._siteLayout||"k"===this._siteLayout?t.push(".headerAndNavContainer"):"c"===this._siteLayout||"h"===this._siteLayout||"l"===this._siteLayout||"m"===this._siteLayout?i(".mobileNav").length&&t.push(".headerAndNavContainer"):(t.push(".headerContainer"),(i(".mobileDropDownNav").length||0===i(".mobileSideNav").length&&0===i(".mobileFullNav").length&&"d"!==this._siteLayout&&"f"!==this._siteLayout)&&t.push(".navContainer"))},destroy:function(){this._unsetHeights(),this._unbindHandlers()}};i.plugin("scFitToWindowGallery",n),i(document).ready(function(){/iPad/.test(navigator.userAgent)&&!e.MSStream&&"preview"===h.attr("data-env")&&(i(".fitToWindowGallery").scFitToWindowGallery({iPadHelper:!0}),i(".fitToWindowGallery").data("scFitToWindowGallery",null));var t=i(".primaryContent").children().first();(t.hasClass("fullDetailsItem")?t.children().first():t).find(".fitToWindowGallery").scFitToWindowGallery()})}(this,jQuery,Modernizr);