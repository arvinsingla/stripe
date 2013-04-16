(function ($) {

  if (typeof Drupal.ajax !== 'undefined') {
    // Keep a reference to the original Drupal.ajax.prototype.beforeSerialize.
    var originalBeforeSerialize = Drupal.ajax.prototype.beforeSerialize;
    /**
     * Handler for the form serialization.
     *
     * Replace original Drupal.ajax.prototype.beforeSerialize to prevent (ajax)
     * submission of card data. This cannot be done using Drupal.detachBehaviors
     * because behaviors are not able to cancel a submission.
     */
    Drupal.ajax.prototype.beforeSerialize = function (element, options) {
      // Use newer jQuery's .prop() when available.
      var propFn = (typeof $.fn.prop === 'function') ? 'prop' : 'attr';
      // Prevent serialisation of form with card data (ie. with enabled stripe
      // inputs elements).
      if (this.form && $(':input[data-stripe]:enabled', this.form).length) {
        // Disable Stripe input elements (and add disabled class on wrapper).
        $(':input[data-stripe]:enabled', this.form)[propFn]('disabled', true)
          .closest('.form-item').addClass('form-disabled');
        // Set publishable key *stored in the form element).
        Stripe.setPublishableKey($.data(this.form, 'stripeKey'));
        // Create the token.
        Stripe.createToken(Drupal.behaviors.stripe.extractTokenData(this.form), $.proxy(Drupal.ajax.prototype.beforeSerializeStripeResponseHandler, this));
        // Cancel this submit, the form will be re-submitted in token creation
        // callback.
        return false;
      } else {
        // Enable the token item.
        // Call original Drupal.ajax.prototype.beforeSerialize.
        originalBeforeSerialize.apply(this, arguments);
      }
    }

    /**
     * Stripe response handler for intercepted (ajax) form submission.
     *
     * @see Drupal.ajax.prototype.beforeSerialize().
     */
    Drupal.ajax.prototype.beforeSerializeStripeResponseHandler = function(status, response) {
      var ajax = this;
      Drupal.behaviors.stripe.processStripeResponse(status, response, ajax.form, function() {
      	ajax.form.ajaxSubmit(ajax.options);
      });
    }
  }

  Drupal.behaviors.stripe = {
    /**
     * Attach Stripe behavior to form elements.
     *
     * @param context
     *   An element to attach behavior to.
     * @param settings
     *   An object containing settings for the current context.
     */
    attach: function (context, settings)  {
      // Use newer jQuery's .prop() when available.
      var propFn = (typeof $.fn.prop === 'function') ? 'prop' : 'attr';
      // Process all Stripe form elements, even if already processed (ie. not
      // using .once() and context is intentional).
      $('*[data-stripe-key]').each(function() {
        // Ensure the current element has an DOM ID.
        if (!this.id) {
          $(this)[propFn]('id', 'stripe-' + Drupal.behaviors.stripe.id++);
        }
        var id = this.id;
        // Retrieve the stripe key for this element.
        var key = $(this).attr('data-stripe-key');
        // Get the form containing the Stripe fieldset.
        $(this).closest('form')
          // Enable Stripe input elements (and remove matching classe).
          .find(':input[data-stripe]:disabled', this)
            [propFn]('disabled', false)
            .closest('.form-item')
            	.removeClass('form-disabled')
            .end()
          .end()
          // Only do the following once for each stripe element.
          .once(id)
          // Register submit handler, with key as event data.
          .submit(Drupal.behaviors.stripe.stripeSubmitHandler)
          // Store the key in the form element, to be used in our submit hanlders.
          .data('stripeKey', key)       
      });
    },
    /**
     * Extract token creation data from a form.
     *
     * Stripe.createToken() should support as first argument and pull the information from
     * inputs marked up with the data-stripe attribute. But it does not seems to properly
     * pull value from <select> elements for the 'exp_month' and 'exp_year' fields.
     *
     */
    extractTokenData: function(form) {
    	var data = {};
    	$(':input[data-stripe]').each(function() {
    	  var input = $(this);
    	  data[input.attr('data-stripe')] = input.val();
    	});
    	return data;
    },
    /**
     * Submit handler for a form containing Stripe inputs.
     *
     * This function expect 'this' to be bound to the submitted form DOM element.
     *
     * @see https://stripe.com/docs/stripe.js#createToken
     *
     * @param event
     *   The triggering event object.
     */
    stripeSubmitHandler: function (event) {
      // Prevent the form from submitting with the default action.
      event.preventDefault();

      // Clear out all errors.
      $(':input[data-stripe].error', this).removeClass('error');
      $('.stripe-errors').remove();

      // Set publishable key.
      Stripe.setPublishableKey($.data(this, 'stripeKey'));

      // Create the token.
      Stripe.createToken(Drupal.behaviors.stripe.extractTokenData(this), $.proxy(Drupal.behaviors.stripe.stripeResponseHandler, this));

      // Prevent the form from submitting with the default action.
      return false;
    },
    /**
     * Stripe (create token) response handler.
     *
     * This function expect 'this' to be bound to the submitted form DOM element.
     *
     * @see https://stripe.com/docs/stripe.js#createToken
     *
     * @param status
     *   The resposne status code, as described in Stripe API doc.
     * @param response
     *   The response object.
     */
    stripeResponseHandler: function(status, response) {
      Drupal.behaviors.stripe.processStripeResponse(status, response, this, $.proxy(this.submit, this));
    },
    /**
     * Process a Stripe (create token) response for a given form.
     *
     * @param status
     *   The resposne status code, as described in Stripe API doc.
     * @param response
     *   The response object.
     * @param form
     *   The form used to create the token.
     * @param submitCallback
    *    The function to call to submit the form (if the response contains a valid token).
     */
    processStripeResponse: function(status, response, form, submitCallback) {
      if (response.error) {
        // Prepend error message to the form, wrapped in a error div.
        $('<div class="stripe-errors messages error"></div>').text(Drupal.t(response.error.message)).prependTo(form);
        // Add error class to the corresponding form element.
        $(':input[data-stripe=' + response.error.param + ']', form).addClass('error');
        // Re-enable Stripe input elements (and remove disabled class on wrapper).
        var propFn = (typeof $.fn.prop === 'function') ? 'prop' : 'attr';
        $(':input[data-stripe]:disabled', form)[propFn]('disabled', false)
          .closest('.form-item').removeClass('form-disabled');
      } else {
        // Use newer jQuery's .prop() when available.
        var propFn = (typeof $.fn.prop === 'function') ? 'prop' : 'attr';
        // Insert the token into the form so it gets submitted to the server.
        $(':input[data-stripe=token]', form).val(response.id);
        // Re-submit the form using AJAX.
        submitCallback();
      }
    },
    /**
     * A unique ID to be assigned to Stripe container element without a DOM ID.
     */
    id: 0
  };
})(jQuery);