import unittest

from election_watch.normalize import normalize_open_america, parse_html_result_tables, partition_precinct_results
from election_watch.state_pages import discover_result_links, is_target_election_link, parse_machine_file


class NormalizeTests(unittest.TestCase):
    def test_open_america_rows_keep_freshness_and_candidate_counts(self):
        payload = {
            "api": 1,
            "year": 2026,
            "live": True,
            "stale": False,
            "counting": True,
            "final": False,
            "as_of": "2026-11-03T22:00:00+00:00",
            "counts": {"races": 1},
            "races": {
                "ME": {
                    "leader": "D",
                    "winner": "",
                    "totalvotes": 1800,
                    "pct_in": 42.0,
                    "cands": [{"n": "Example Candidate", "p": "D", "v": 1234, "pct": 52.5}],
                }
            },
        }
        rows, status = normalize_open_america(payload, "Senate", "2026-11-03T22:01:00+00:00")
        self.assertEqual(rows[0]["state"], "ME")
        self.assertEqual(rows[0]["votes"], 1234)
        self.assertTrue(rows[0]["feedLive"])
        self.assertFalse(rows[0]["feedFinal"])
        self.assertEqual(rows[0]["raceWinner"], "")
        self.assertEqual(rows[0]["feedTotalVotes"], 1800)
        self.assertFalse(status["stale"])

    def test_open_america_normalizes_final_race_winner_metadata(self):
        payload = {
            "api": 1,
            "final": True,
            "races": {
                "ME": {
                    "winner": "Ada Example",
                    "totalvotes": 1800,
                    "cands": [{"n": "Ada Example", "p": "D", "v": 1000, "pct": 55.6}],
                }
            },
        }
        rows, _ = normalize_open_america(payload, "Senate", "now")
        self.assertTrue(rows[0]["feedFinal"])
        self.assertEqual(rows[0]["raceWinner"], "Ada Example")
        self.assertTrue(rows[0]["winnerDeclared"])
        self.assertEqual(rows[0]["feedTotalVotes"], 1800)

    def test_html_table_requires_candidate_and_vote_headers(self):
        html = b"""
        <table><tr><th>Race</th><th>Candidate</th><th>Party</th><th>Votes</th><th>Percent Reporting</th></tr>
        <tr><td>U.S. Senate</td><td>Ada Example</td><td>D</td><td>12,345</td><td>35%</td></tr></table>
        <table><tr><th>Town</th><th>Registered Voters</th></tr><tr><td>Sample</td><td>200</td></tr></table>
        """
        rows = parse_html_result_tables(html, state="ME", source_name="Maine", source_url="https://example.gov/results", captured_at="now")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["race"], "U.S. Senate")
        self.assertEqual(rows[0]["votes"], 12345)
        self.assertTrue(rows[0]["verificationRequired"])

    def test_discovery_finds_result_csv_and_page(self):
        html = b'<a href="/2026-results.csv">Official results CSV</a><a href="/2026-election-results">Election Results</a><a href="/elections">Elections</a><a href="/faq">FAQs</a>'
        links = discover_result_links(html, "https://example.gov/elections/")
        self.assertEqual(len(links), 2)
        by_url = {link["url"]: link for link in links}
        self.assertEqual(by_url["https://example.gov/2026-results.csv"]["kind"], "machine-readable-file")
        self.assertEqual(by_url["https://example.gov/2026-election-results"]["kind"], "linked-page")
        self.assertNotIn("https://example.gov/elections", by_url)

    def test_discovery_ignores_navigation_fragments(self):
        html = b'<a href="/elections#results">Skip to results</a><a href="/results/2026">2026 Results</a>'
        links = discover_result_links(html, "https://example.gov/")
        self.assertEqual([link["url"] for link in links], ["https://example.gov/results/2026"])

    def test_discovery_preserves_official_county_results_directory(self):
        html = b'<a href="/county-election-websites">Click here for all county websites</a>'
        links = discover_result_links(html, "https://myvote.example.gov/Election-Results")
        self.assertEqual(len(links), 1)
        self.assertEqual(links[0]["kind"], "official-county-results-directory")

    def test_discovery_only_follows_result_files_for_the_configured_election_year(self):
        self.assertTrue(is_target_election_link(
            {"label": "2026 General Election results", "url": "https://example.gov/results.csv"}, 2026))
        self.assertFalse(is_target_election_link(
            {"label": "Election Results", "url": "https://example.gov/results/24GENR/ENRbyPrecinct.csv"}, 2026))
        self.assertFalse(is_target_election_link(
            {"label": "Election Results", "url": "https://example.gov/results.csv"}, 2026))
        self.assertFalse(is_target_election_link(
            {"label": "2026 Results", "url": "https://example.gov/results/2024.csv"}, 2026))
        self.assertTrue(is_target_election_link(
            {"label": "Results", "url": "https://example.gov/results.csv", "electionYearContext": "2026"}, 2026))

    def test_csv_parser_normalizes_common_headers(self):
        content = b"Race,Candidate,Party,Votes,Percent Reporting\nU.S. Senate,Sam Sample,R,900,10%\n"
        rows = parse_machine_file(content, "https://example.gov/results.csv", state="AK", source_name="Alaska", captured_at="now")
        self.assertEqual(rows[0]["candidate"], "Sam Sample")
        self.assertEqual(rows[0]["votes"], 900)
        self.assertEqual(rows[0]["precinctsReportingPct"], 10.0)

    def test_csv_parser_rejects_rows_without_a_named_contest(self):
        content = b"Candidate,Party,Vote Total\nSam Sample,D,900\n"
        rows = parse_machine_file(content, "https://example.gov/results.csv", state="AK", source_name="Alaska", captured_at="now")
        self.assertEqual(rows, [])

    def test_csv_parser_preserves_county_name_and_normalizes_county_fips(self):
        content = b"Race,County,Candidate,Party,Votes,County FIPS\nU.S. Senate,Penobscot,Ada Example,D,1234,23019\n"
        rows = parse_machine_file(content, "https://example.gov/results.csv", state="ME", source_name="Maine", captured_at="now")
        self.assertEqual(rows[0]["county"], "Penobscot")
        self.assertEqual(rows[0]["countyFips"], "23019")

    def test_csv_parser_expands_county_code_with_state_fips(self):
        content = b"Contest,County Name,Candidate,Vote Total,County Code\nU.S. Senate,Penobscot,Ada Example,1234,019\n"
        rows = parse_machine_file(content, "https://example.gov/results.csv", state="ME", source_name="Maine", captured_at="now")
        self.assertEqual(rows[0]["countyFips"], "23019")

    def test_csv_parser_preserves_congressional_district(self):
        content = b"Contest,District,Candidate,Party,Votes\nU.S. House,2,Ada Example,D,1234\n"
        rows = parse_machine_file(content, "https://example.gov/results.csv", state="ME", source_name="Maine", captured_at="now")
        self.assertEqual(rows[0]["district"], "2")

    def test_precinct_csv_rows_preserve_reporting_and_outstanding_vote_fields(self):
        content = (
            b"Contest,County,Precinct,Precinct ID,Candidate,Party,Votes,"
            b"Precincts Reported,Precincts Total,Votes Outstanding,Ballots Outstanding\n"
            b"U.S. Senate,Penobscot,Portland 1,001,Ada Example,D,1234,4,12,250,275\n"
        )
        rows = parse_machine_file(
            content,
            "https://example.gov/2026-results.csv",
            state="ME",
            source_name="Maine",
            captured_at="2026-11-03T22:00:00+00:00",
        )
        self.assertEqual(rows[0]["precinct"], "Portland 1")
        self.assertEqual(rows[0]["precinctId"], "001")
        self.assertEqual(rows[0]["precinctsReported"], 4)
        self.assertEqual(rows[0]["precinctsTotal"], 12)
        self.assertEqual(rows[0]["votesOutstanding"], 250)
        self.assertEqual(rows[0]["ballotsOutstanding"], 275)
        aggregate_rows, precinct_rows = partition_precinct_results(rows)
        self.assertEqual(aggregate_rows, [])
        self.assertEqual(precinct_rows[0]["reportingUnitType"], "precinct")

    def test_html_parser_preserves_county_column(self):
        html = b"""
        <table><tr><th>Contest</th><th>County</th><th>Candidate</th><th>Votes</th><th>County Code</th></tr>
        <tr><td>U.S. Senate</td><td>Penobscot</td><td>Ada Example</td><td>1,234</td><td>019</td></tr></table>
        """
        rows = parse_html_result_tables(html, state="ME", source_name="Maine", source_url="https://example.gov/results", captured_at="now")
        self.assertEqual(rows[0]["county"], "Penobscot")
        self.assertEqual(rows[0]["countyFips"], "23019")

    def test_html_parser_preserves_precinct_identifiers(self):
        html = b"""
        <table><tr><th>Contest</th><th>County</th><th>Precinct</th><th>Candidate</th><th>Votes</th></tr>
        <tr><td>U.S. Senate</td><td>Penobscot</td><td>Portland 1</td><td>Ada Example</td><td>1,234</td></tr></table>
        """
        rows = parse_html_result_tables(html, state="ME", source_name="Maine", source_url="https://example.gov/results", captured_at="now")
        self.assertEqual(rows[0]["precinct"], "Portland 1")
        self.assertEqual(partition_precinct_results(rows)[1][0]["reportingUnitType"], "precinct")


if __name__ == "__main__":
    unittest.main()
