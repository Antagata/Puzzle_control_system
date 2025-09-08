from server_utils import coerce_week_shape, empty_week

def test_empty():
    assert coerce_week_shape(None) == empty_week()

def test_partial():
    wk = coerce_week_shape({"monday":[1], "Foo":[2], "Sunday":[3]})
    assert wk["Monday"] == [1]
    assert wk["Sunday"] == [3]
    assert wk["Tuesday"] == []
