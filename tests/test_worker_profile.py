import unittest
import server

class WorkerProfileTest(unittest.TestCase):
    def test_preserves_cep_city_birth_and_transport_in_limited_region(self):
        data = server.validate({"nome": "Pessoa sintética", "cpf": "52998224725", "data_nascimento": "1990-04-10", "cidade": "Caucaia", "uf": "CE", "pode_se_deslocar": False, "transporte": "Ônibus, Uber", "observacoes_locomocao": "Centro", "rede_trabalho": "Hipermarket"})
        self.assertEqual(data["cidade"], "Caucaia")
        self.assertEqual(data["data_nascimento"], "1990-04-10")
        self.assertEqual(data["transporte"], "Ônibus, Uber")
        self.assertEqual(data["rede_trabalho"], "Hipermarket")

    def test_rejects_future_birth_date(self):
        with self.assertRaisesRegex(ValueError, "nascimento"):
            server.validate({"nome": "Pessoa sintética", "cpf": "52998224725", "data_nascimento": "2099-01-01"})
