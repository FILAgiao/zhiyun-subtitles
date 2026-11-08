import unittest
from unittest.mock import patch

from backend.pricing import DEFAULT_MODEL, pricing_catalog, summarize_token_cost
from backend import test_server as fixture
from backend.server import month


def call(**changes):
    return dict({'kind': 'ark', 'state': 'complete', 'model': DEFAULT_MODEL,
                 'input_tokens': 1000000, 'output_tokens': 1000000,
                 'cached_input_tokens': 0}, **changes)


class PricingTests(unittest.TestCase):
    def test_exact_official_prices_and_cache_discount(self):
        result = summarize_token_cost([call(cached_input_tokens=500000),
            call(model='doubao-seed-translation-250915')])
        self.assertEqual(result['amount_cny'], '7.980000')
        self.assertEqual(result['cache_detail_missing_calls'], 0)
        self.assertFalse(result['actual_billing_connected'])

    def test_missing_cache_uses_explicit_undiscounted_reference(self):
        result = summarize_token_cost([call(cached_input_tokens=None)])
        self.assertEqual(result['amount_cny'], '3.500000')
        self.assertEqual(result['cache_detail_missing_calls'], 1)
        self.assertEqual(result['basis'], 'current_official_reference')

    def test_unknown_unsettled_empty_usage_are_not_free(self):
        result = summarize_token_cost([call(), call(state='unknown'),
            call(model='ep-custom'), call(input_tokens=0, output_tokens=0),
            call(kind='speech', model='speech')])
        self.assertIsNone(result['amount_cny'])
        self.assertEqual(result['known_amount_cny'], '3.500000')
        self.assertEqual(result['unpriced_calls'], 3)
        self.assertEqual(result['excluded_non_token_calls'], 1)

    def test_exact_model_mapping_and_input_validation(self):
        for values in ({'model': 'doubao-seed-2-1-lite-future'},
                       {'cached_input_tokens': 1000001}, {'input_tokens': True},
                       {'cached_input_tokens': -1}, {'output_tokens': '100'},
                       {'model': 'doubao-seed-translation-250915', 'cached_input_tokens': 1}):
            with self.subTest(values=values):
                self.assertIsNone(summarize_token_cost([call(**values)])['amount_cny'])

    def test_zero_and_decimal_totals_and_catalog(self):
        self.assertEqual(summarize_token_cost([])['amount_cny'], '0.000000')
        result = summarize_token_cost(call(input_tokens=1, output_tokens=1) for _ in range(100000))
        self.assertEqual(result['amount_cny'], '0.350000')
        with patch.dict('os.environ', {'ARK_LEARNING_MODEL': 'ep-private'}):
            self.assertEqual(pricing_catalog()['default_model'], 'ep-private')
        self.assertEqual(pricing_catalog()['checked_at'], '2026-11-06')


class IntegrationTests(unittest.TestCase):
    setUp = fixture.Tests.setUp
    upstream = fixture.Tests.upstream
    call = fixture.Tests.call

    def test_reference_cost_does_not_rewrite_configured_history(self):
        self.call('/v1/ark/responses', self.body)
        result = self.gateway.operations_overview(month())
        self.assertIsNone(result['summary']['estimated_cost_cny'])
        self.assertEqual(result['summary']['token_estimate']['amount_cny'], '0.000019')
        self.assertEqual(result['models'][0]['token_estimate']['amount_cny'], '0.000019')
        self.assertEqual(result['cost_rates'], [])
        self.assertEqual(result['pricing_catalog']['mode'], 'standard_online')


if __name__ == '__main__':
    unittest.main()
