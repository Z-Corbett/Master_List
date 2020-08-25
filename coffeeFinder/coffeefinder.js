console.log("js is working");
var selectOne = document.getElementById("select-one");
var selectTwo = document.getElementById("select-two");
var selectThree = document.getElementById("select-three");
var selectFour = document.getElementById("select-four");
var showPromptOne = function () {
	$('#prompt-one').delay(300).fadeIn(500);
};
var showPromptTwo = function () {
	$('#prompt-two').delay(300).fadeIn(500);
};
var showPromptThree = function () {
	$('#prompt-three').delay(300).fadeIn(500);
};
var showPromptFour = function () {
	$('#prompt-four').delay(300).fadeIn(500);
};
var fadeInChoices = function (selectnumber) {
	$(selectnumber).fadeIn(500);
};
var answerLog = []
$('.start-quiz').click(function () {
	$('.quiz-section').velocity('scroll', {
		duration : 400,
		easing : "ease-out"
	});
});
$('.select-one').click(function () {
	fadeInChoices('.one');
});
$('.choice-one').click(function () {
	var choiceText = $(this).text();
	$('.select-one').html(choiceText);
	$(this).parent().parent().fadeOut(200);
	showPromptTwo();
	answerLog.feeling = choiceText;
});
$('.select-two').click(function () {
	fadeInChoices('.two');
});
$('.choice-two').click(function () {
	var choiceText = $(this).text();
	$('.select-two').html(choiceText);
	$(this).parent().parent().fadeOut(200);
	showPromptThree();
	answerLog.wifi = choiceText;
});
$('.select-three').click(function () {
	fadeInChoices('.three');
});
$('.choice-three').click(function () {
	var choiceText = $(this).text();
	$('.select-three').html(choiceText);
	$(this).parent().parent().fadeOut(200);
	showPromptFour();
	answerLog.toast = choiceText;
});
$('.select-four').click(function () {
	fadeInChoices('.four');
});
$('.choice-four').click(function () {
	var choiceText = $(this).text();
	$('.select-four').html(choiceText);
	$(this).parent().parent().fadeOut(200);
	answerLog.traveling = choiceText;
	$('.paragraph').delay(300).fadeOut(300);
	showFinalAnswer();
});
function showFinalAnswer() {
	if (answerLog.feeling === "cheery" && answerLog.wifi === "wifi" && answerLog.toast === "amazing" && answerLog.traveling === "solo") {
		$('.urbanstandard').show();
	} else if (answerLog.feeling === "cheery" && answerLog.wifi === "wifi" && answerLog.toast === "amazing" && answerLog.traveling === "with a group") {
		$('.andytown').show();
	} else if (answerLog.feeling === "pensive" && answerLog.wifi === "wifi" && answerLog.toast === "amazing" && answerLog.traveling === "solo") {
		$('.feast').show();
	} else if (answerLog.feeling === "pensive" && answerLog.wifi === "wifi" && answerLog.toast === "amazing" && answerLog.traveling === "with a group") {
		$('.andytown').show();
	} else if (answerLog.feeling === "productive" && answerLog.wifi === "wifi" && answerLog.toast === "amazing" && answerLog.traveling === "solo") {
		$('.feast').show();
	} else if (answerLog.feeling === "productive" && answerLog.wifi === "wifi" && answerLog.toast === "amazing" && answerLog.traveling === "with a group") {
		$('.revelator').show();
	} else if (answerLog.feeling === "cheery" && answerLog.wifi === "wifi" && answerLog.toast === "not for me" && answerLog.traveling === "solo") {
		$('.octane-coffee').show();
	} else if (answerLog.feeling === "cheery" && answerLog.wifi === "wifi" && answerLog.toast === "not for me" && answerLog.traveling === "with a group") {
		$('.lucys').show();
	} else if (answerLog.feeling === "pensive" && answerLog.wifi === "wifi" && answerLog.toast === "not for me" && answerLog.traveling === "solo") {
		$('.crestwood').show();
	} else if (answerLog.feeling === "pensive" && answerLog.wifi === "wifi" && answerLog.toast === "not for me" && answerLog.traveling === "with a group") {
		$('.church-street').show();
	} else if (answerLog.feeling === "productive" && answerLog.wifi === "wifi" && answerLog.toast === "not for me" && answerLog.traveling === "solo") {
		$('.ohenrys').show();
	} else if (answerLog.feeling === "productive" && answerLog.wifi === "wifi" && answerLog.toast === "not for me" && answerLog.traveling === "with a group") {
		$('.abbey').show();
	} else if (answerLog.feeling === "cheery" && answerLog.wifi === "no wifi" && answerLog.toast === "amazing" && answerLog.traveling === "solo") {
		$('.seeds').show();
	} else if (answerLog.feeling === "cheery" && answerLog.wifi === "no wifi" && answerLog.toast === "amazing" && answerLog.traveling === "with a group") {
		$('.cat').show();
	} else if (answerLog.feeling === "pensive" && answerLog.wifi === "no wifi" && answerLog.toast === "amazing" && answerLog.traveling === "solo") {
		$('.seeds').show();
	} else if (answerLog.feeling === "pensive" && answerLog.wifi === "no wifi" && answerLog.toast === "amazing" && answerLog.traveling === "with a group") {
		$('.seeds').show();
	} else if (answerLog.feeling === "productive" && answerLog.wifi === "no wifi" && answerLog.toast === "amazing" && answerLog.traveling === "solo") {
		$('.cat').show();
	} else if (answerLog.feeling === "productive" && answerLog.wifi === "no wifi" && answerLog.toast === "amazing" && answerLog.traveling === "with a group") {
		$('.cat').show();
	} else if (answerLog.feeling === "cheery" && answerLog.wifi === "no wifi" && answerLog.toast === "not for me" && answerLog.traveling === "solo") {
		$('.bakery').show();
	} else if (answerLog.feeling === "cheery" && answerLog.wifi === "no wifi" && answerLog.toast === "not for me" && answerLog.traveling === "with a group") {
		$('.vintage').show();
	} else if (answerLog.feeling === "pensive" && answerLog.wifi === "no wifi" && answerLog.toast === "not for me" && answerLog.traveling === "solo") {
		$('.saturn').show();
	} else if (answerLog.feeling === "pensive" && answerLog.wifi === "no wifi" && answerLog.toast === "not for me" && answerLog.traveling === "with a group") {
		$('.OPEN').show();
	} else if (answerLog.feeling === "productive" && answerLog.wifi === "no wifi" && answerLog.toast === "not for me" && answerLog.traveling === "solo") {
		$('.ritual').show();
	} else if (answerLog.feeling === "productive" && answerLog.wifi === "no wifi" && answerLog.toast === "not for me" && answerLog.traveling === "with a group") {
		$('.urbanstandard').show();
	}
};
$('.play-again').click(function () {
	location.reload();
});