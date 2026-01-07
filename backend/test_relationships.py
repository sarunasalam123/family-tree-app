import backend


def test_grandparent_and_grandchild():
    assert backend.relationship_name(0, 2) == "grandparent"
    assert backend.relationship_name(2, 0) == "grandchild"


def test_great_grandparent_and_great_grandchild():
    assert backend.relationship_name(0, 3) == "great grandparent"
    assert backend.relationship_name(3, 0) == "great grandchild"


def test_cousins_and_removed():
    assert backend.relationship_name(2, 2) == "1st cousin"
    assert backend.relationship_name(2, 3) == "1st cousin once removed"
    assert backend.relationship_name(3, 3) == "2nd cousin"


def test_aunt_uncle_and_niece_nephew():
    assert backend.relationship_name(1, 2) == "aunt/uncle"
    assert backend.relationship_name(2, 1) == "niece/nephew"
