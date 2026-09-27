"""Unidades pesquisadas em 27/09/2026. Fontes ficam junto dos registros."""

ELO = "https://media.elo.com.br/strapi-hml/LISTA_DE_MERCADOS_PDV_8688a49c48.pdf"
POVO = "https://www.linkedin.com/company/super-do-povo"
LAGOA = "https://superlagoa.com.br/lojas.php"
HIPER = "https://superhipermarket.com.br/hipermarket/"
UNIFORCA = "https://www.redeuniforca.com.br/associados/"
PINHEIRO = "https://www.linkedin.com/company/pinheiro-supermercado---o-bom-vizinho"

# rede, loja, endereço, bairro, cidade, fonte, situação, observação
LOJAS = [
    ("Super do Povo", "Henrique Jorge", "Av. Coronel Matos Dourado, 599", "Henrique Jorge", "Fortaleza", ELO, "revisar", "Outro endereço divulgado: Rua Prof. Edgard de Arruda, 1050."),
    ("Super do Povo", "José Walter", "Av. Bernardo Manuel, 1104", "José Walter", "Fortaleza", ELO, "revisar", "Outro endereço divulgado: Av. N, 1104."),
    ("Super do Povo", "Conjunto Ceará", "Av. A, 800", "Conjunto Ceará", "Fortaleza", ELO, "confirmado", ""),
    ("Super do Povo", "Passaré", "Rua XII, 200", "Passaré", "Fortaleza", POVO, "confirmado", ""),
    ("Super do Povo", "Parque Dois Irmãos", "Rua Ecilda de Queiroz, 200", "Parque Dois Irmãos", "Fortaleza", ELO, "confirmado", ""),
    ("Super do Povo", "Cambeba", "Av. Ministro José Américo, 709", "Cambeba", "Fortaleza", ELO, "confirmado", ""),
    ("Super do Povo", "Jurema", "Av. São Vicente de Paula, 101", "Jurema", "Caucaia", ELO, "confirmado", ""),
    ("Super do Povo", "Guararapes", "Av. Atilano de Moura, 320", "Guararapes", "Fortaleza", ELO, "confirmado", ""),
    ("Super do Povo", "Meireles", "Rua Júlio Ibiapina, 291", "Meireles", "Fortaleza", ELO, "confirmado", ""),
    ("Super do Povo", "Joaquim Távora / Antônio Sales", "Rua Monsenhor Bruno, 2333", "Joaquim Távora", "Fortaleza", ELO, "confirmado", ""),
    ("Super do Povo", "Montese", "Av. Professor Gomes de Matos, 1703", "Montese", "Fortaleza", "https://www.portaldenoticiasnossaterranews.com/noticia/de-operador-de-caixa-a-gerente-a-trajetoria-de-superacao-de-pedro-henrique-inspira-colaboradores-no-super-do-povo", "revisar", "Loja inaugurada em 2026; confirme o número diretamente com a rede antes de enviar."),
    ("Super Lagoa", "Parangaba", "Av. Gomes Brasil, 201", "Parangaba", "Fortaleza", "https://superlagoa.com.br/loja.php?id=1", "confirmado", ""),
    ("Super Lagoa", "Centro", "Rua Sólon Pinheiro, 136", "Centro", "Fortaleza", "https://superlagoa.com.br/loja.php?id=2", "confirmado", ""),
    ("Super Lagoa", "Barra do Ceará", "Av. Mozart Pinheiro de Lucena, 1711", "Barra do Ceará", "Fortaleza", "https://superlagoa.com.br/loja.php?id=4", "confirmado", ""),
    ("Super Lagoa", "North Shopping", "Av. Bezerra de Menezes, 2450", "São Gerardo", "Fortaleza", "https://superlagoa.com.br/loja.php?id=7", "confirmado", ""),
    ("Super Lagoa", "Luciano Cavalcante", "Rua Virgílio Bastos dos Santos, 66", "Luciano Cavalcante", "Fortaleza", "https://superlagoa.com.br/loja.php?id=9", "confirmado", ""),
    ("Super Lagoa", "Cidade 2000", "Avenida Central, 190", "Cidade 2000", "Fortaleza", "https://superlagoa.com.br/loja.php?id=10", "revisar", "Regulamento da rede traz Av. Central Oeste, 1001."),
    ("Super Lagoa", "Rodolfo Teófilo", "Rua Professor Costa Mendes, 2065", "Rodolfo Teófilo", "Fortaleza", "https://superlagoa.com.br/loja.php?id=14", "confirmado", ""),
    ("Super Lagoa", "Lago Jacarey", "Av. Pedro Lazar, 877", "Cidade dos Funcionários", "Fortaleza", "https://superlagoa.com.br/loja.php?id=16", "confirmado", ""),
    ("Super Lagoa", "Santos Dumont", "Av. Santos Dumont, 3860", "Aldeota", "Fortaleza", "https://superlagoa.com.br/loja.php?id=17", "revisar", "Lista da Elo traz nº 3870."),
    ("Super Lagoa", "Bernardo Manuel / Mondubim", "Av. Bernardo Manuel, 11000", "Mondubim", "Fortaleza", "https://superlagoa.com.br/loja.php?id=19", "revisar", "Outras listas trazem nº 10970 ou 1080."),
    ("Fazendinha", "Vicente Linhares", "Rua Vicente Linhares, 1111", "Aldeota", "Fortaleza", "https://fazendinhasupermercados.com.br/sobre", "confirmado", ""),
    ("Fazendinha", "Abolição", "Av. da Abolição, 3080", "Meireles", "Fortaleza", "https://abolicao.fazendinhasupermercados.com.br/sobre", "confirmado", ""),
    ("Fazendinha", "Eusébio", "Av. Eusébio de Queiroz, 2850", "Coité", "Eusébio", "https://eusebio.fazendinhasupermercados.com.br/sobre", "confirmado", ""),
    ("Hipermarket", "Vila União", "Rua Livreiro Gualter, 123", "Vila União", "Fortaleza", HIPER, "confirmado", ""),
    ("Hipermarket", "Jardim Cearense", "Rua Rubens Monte, 380", "Jardim Cearense", "Fortaleza", HIPER, "confirmado", ""),
    ("Hipermarket", "Serrinha", "Rua Freire Alemão, 356", "Serrinha", "Fortaleza", HIPER, "confirmado", ""),
    ("Hipermarket", "Mondubim", "Av. Benjamim Brasil, 1099", "Mondubim", "Fortaleza", HIPER, "confirmado", ""),
    ("Hipermarket", "Eusébio", "Rua Embaúba, 5", "Centro", "Eusébio", HIPER, "confirmado", ""),
    ("Pinheiro", "Rogaciano Leite", "Av. Rogaciano Leite, 2080", "", "Fortaleza", PINHEIRO, "confirmado", ""),
    ("Pinheiro", "Praia de Iracema", "Av. Monsenhor Tabosa, 697", "Praia de Iracema", "Fortaleza", PINHEIRO, "confirmado", ""),
    ("Pinheiro", "Antônio Sales", "Av. Antônio Sales, 3266", "", "Fortaleza", PINHEIRO, "confirmado", ""),
    ("Pinheiro", "Washington Soares", "Av. Washington Soares, 10008, loja 6", "", "Fortaleza", PINHEIRO, "confirmado", ""),
    ("Pinheiro", "Messejana", "Av. Frei Cirilo, 4290", "Messejana", "Fortaleza", PINHEIRO, "confirmado", ""),
    ("Pinheiro", "Mondubim", "Av. Godofredo Maciel, 4000", "Mondubim", "Fortaleza", PINHEIRO, "confirmado", ""),
    ("Pinheiro", "Maraponga", "Av. Godofredo Maciel, 1152", "Maraponga", "Fortaleza", PINHEIRO, "confirmado", ""),
    ("Pinheiro", "Pan-Americano", "Rua Piauí, 1110", "Pan-Americano", "Fortaleza", PINHEIRO, "confirmado", ""),
    ("Pinheiro", "Cambeba", "Av. Ministro José Américo, 284", "Cambeba", "Fortaleza", ELO, "confirmado", ""),
    ("Pinheiro", "Aquiraz", "Av. Nossa Senhora de Lourdes, 77", "", "Aquiraz", PINHEIRO, "confirmado", ""),
    ("Pinheiro", "Porto das Dunas", "Loteamento Porto das Dunas, s/n", "Porto das Dunas", "Aquiraz", ELO, "revisar", "Endereço sem número; confirme o ponto de encontro."),
    ("Pinheiro", "Maranguape", "Rua Chico Anísio, 200", "", "Maranguape", ELO, "confirmado", ""),
    ("Variedades", "Nova Metrópole", "Av. Contorno Leste, 6", "Nova Metrópole", "Caucaia", "https://www.variedadessupermercados.com.br/", "revisar", "Rede Uniforça informa esta avenida como s/n."),
    ("Variedades", "Caucaia", "Rua Vinte e Quatro de Janeiro, 215", "", "Caucaia", UNIFORCA, "confirmado", ""),
    ("Variedades", "Conjunto Metropolitano", "Rua Cordeiro de Miranda, 1311", "Conjunto Metropolitano", "Caucaia", UNIFORCA, "confirmado", ""),
]
