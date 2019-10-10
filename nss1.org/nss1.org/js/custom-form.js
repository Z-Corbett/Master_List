var SixQube = { pwVisitorId: ''};
SixQube.init = function () {
    try {
        var e = this;
        _paq.push([ function () { e.pwVisitorId = this.getVisitorId(); }]);
    } catch (err) { }
};


(function ($) {

    //jQuery is required for this script to work
    $(document).ready(function () {


        //don't know why .die() was needed but keeping for legacy support
        //deprecated in version 1.7
        var version = parseFloat(jQuery.fn.jquery);
        if(version >= 1.4 && version < 1.7){
            $('.custom-form').die();
        }







        SixQube.init();

        $("a[rel^='prettyPhoto']").click(function () { $('.custom-form input[name=visitorId]').val(SixQube.pwVisitorId); });



        $('.custom-form').submit(function (event) {



            if ($(this).hasClass('ajaxSubmit')) {
                event.stopPropagation();
            }

            var formID = $(this).attr('id');

            $('.form' + formID + ' .highlightError').each(function () {
                $(this).removeClass('highlightError');
            });

            $('.form' + formID + ' .checkboxDiv').each(function () {
                if ($(this).hasClass('checkboxDivHighlightError')) {
                    $(this).removeClass('checkboxDivHighlightError');
                }
            });

            var errors = 0, numOnlyErrors = 0, numOnlyErrorText = '';

            $('.form' + formID + ' .required').each(function () {
                if ( $(this).val() == '' ){
                    $(this).addClass('highlightError');
                    errors += 1;
                }
                else if ($(this).is(':checkbox:not(:checked)')) {
                    $(this).parent().addClass('checkboxDivHighlightError');
                    errors += 1;
                }
            });

            $('.form' + formID + ' .numsOnly').each(function () {
                var val = $(this).attr('value');
                if (val && isNaN(val)) {
                    var fieldName = $(this).parent().find('label').html();
                    numOnlyErrors += 1;
                    numOnlyErrorText = numOnlyErrorText + fieldName + ' may only contain numbers\n';
                }
            });

            $('.form' + formID + ' .email').each(function () {
                var val = $(this).attr('value');
                var filter = /^([a-zA-Z0-9_\.\-])+@(([a-zA-Z0-9\-])+\.)+([a-zA-Z0-9]{2,4})+$/;
                if (val && !filter.test(val)) {
                    var fieldName = $(this).parent().find('label').html();
                    numOnlyErrors += 1;
                    numOnlyErrorText = 'Please enter a valid email address\n';
                }
            });

            if (errors>0 || numOnlyErrors>0)
            {
                if (errors>0) alert('Please complete the highlighted required fields');
                if (numOnlyErrorText) alert(numOnlyErrorText);
                return false;
            }
            else if ($(this).hasClass('ajaxSubmit'))
            {
                var submitURL = $(this).attr('action');
                var params = $(this).serialize();
                params['visitorId']	= SixQube.pwVisitorId;

                var submitBtn = $('.form' + formID + ' #submit');
                var submitValue = submitBtn.val();
                if (!submitValue) { submitValue = 'Submit'; }

                submitBtn.prop( "disabled", true ).val('Loading...');


                $.post(submitURL, params, function(data){
                    if (data.success==1)
                    {
                        if (!data.redir) {
                            alert('Your response was successfully sent');
                            submitBtn.prop( "disabled", false ).val(submitValue);
                        }
                        else {
                            window.location = data.redir;
                        }
                    }
                    else {
                        alert('Sorry, there was an error submitting your form.  Please try again.');
                        submitBtn.prop( "disabled", false ).val(submitValue);
                    }
                }, 'json');
                return false;
            } else {
                $('.custom-form #submit').attr("disabled", true);
            }
            this.visitorId.value = SixQube.pwVisitorId;
            submitBtn.prop( "disabled", true ).val('Loading...');
        });

        $('.custom-form #reset').click(function (){
            var formID = $(this).parent().parent().parent().parent().attr('id');
            if (confirm('Are you sure you want to clear the entire form?')) {
                $('.form' + formID + ' input').each(function (){
                    if ($(this).attr('id')!='submit' && $(this).attr('id')!='reset' && $(this).attr('type')!='hidden') {
                        $(this).attr('value', '');
                        if ($(this).hasClass('checkbox')) {
                            $(this).attr('checked', false);
                        }
                    }
                });
                $('.form' + formID + ' textarea').each(function () {
                    $(this).val('');
                });
            }
            return false;
        });
    });

})(jQuery);
