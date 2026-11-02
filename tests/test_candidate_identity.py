import unittest

from scripts.candidate_identity import evaluate, normalize_file, photo_too_old


def entity(qid, human=True, dead=False, image=None):
    claims = {"P31": [{"mainsnak": {"datavalue": {"value": {"id": "Q5" if human else "Q4167410"}}}}]}
    if dead:
        claims["P570"] = [{"mainsnak": {"datavalue": {"value": {"time": "+1983-01-01"}}}}]
    if image:
        claims["P18"] = [{"mainsnak": {"datavalue": {"value": image}}}]
    return {"id": qid, "claims": claims}


FORD = "Aaron Ford (born 1972) is an American politician, Nevada Attorney General and Democratic nominee for governor of Nevada."


class CandidateIdentityTests(unittest.TestCase):
    def test_accepts_living_politician_tied_to_state_and_party(self):
        verdict = evaluate("Aaron Ford", "NV", "D", [entity("Q1", image="Ford.jpg")],
                           {"Q1": ("https://en.wikipedia.org/wiki/Aaron_Ford", FORD)})
        self.assertTrue(verdict.ok)
        self.assertEqual(verdict.image_file, "Ford.jpg")

    def test_rejects_historical_namesake(self):
        verdict = evaluate("Aaron Ford", "NV", "D", [entity("Q2", dead=True, image="Old.jpg")],
                           {"Q2": ("u", "Aaron Ford (1903-1983) was a U.S. Representative from Mississippi.")})
        self.assertFalse(verdict.ok)

    def test_rejects_person_from_another_state_or_party(self):
        articles = {"Q3": ("u", "Sam Lee is an American politician from Ohio, a Republican.")}
        self.assertFalse(evaluate("Sam Lee", "NV", "R", [entity("Q3", image="a.jpg")], articles).ok)
        self.assertFalse(evaluate("Sam Lee", "OH", "D", [entity("Q3", image="a.jpg")], articles).ok)

    def test_rejects_non_politician_and_non_human(self):
        articles = {"Q4": ("u", "Alan Wilson is a tram in Nevada."), "Q5": ("u", "A Nevada politician group.")}
        self.assertFalse(evaluate("Alan Wilson", "NV", "D", [entity("Q4", image="a.jpg")], articles).ok)
        self.assertFalse(evaluate("Alan Wilson", "NV", "D", [entity("Q5", human=False, image="a.jpg")], articles).ok)

    def test_ambiguous_matches_are_rejected_not_guessed(self):
        articles = {q: ("u", FORD) for q in ("Q6", "Q7")}
        verdict = evaluate("Aaron Ford", "NV", "D", [entity("Q6", image="a.jpg"), entity("Q7", image="b.jpg")], articles)
        self.assertFalse(verdict.ok)

    def test_verified_person_without_portrait_gets_no_photo(self):
        verdict = evaluate("Aaron Ford", "NV", "D", [entity("Q1")], {"Q1": ("u", FORD)})
        self.assertFalse(verdict.ok)
        self.assertEqual(verdict.qid, "Q1")

    def test_old_photos_are_rejected(self):
        self.assertTrue(photo_too_old({"DateTimeOriginal": {"value": "1934-05-01"}}, "x.jpg"))
        self.assertTrue(photo_too_old({}, "Adam Hamilton, 1930s.jpg"))
        self.assertFalse(photo_too_old({"DateTimeOriginal": {"value": "2023-10-17"}}, "x.jpg"))

    def test_file_name_normalization(self):
        self.assertEqual(normalize_file("File:Adam_Gray  119th.jpg"), normalize_file("Adam Gray 119th.jpg"))


if __name__ == "__main__":
    unittest.main()
